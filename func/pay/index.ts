import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Asserts, ValidationError } from "yup";
import * as yup from "yup";
import { authenticate, AuthenticationError } from "../common/auth";
import { HttpResponseBuilder } from "../common/http";
import BigDecimal from "js-big-decimal";
import { loadAccount, makePayment, muxedAccount } from "../common/stellar";
import { execute } from "../common/database";
import { v4 } from "uuid";

const RequestSchema = yup.object({
  body: yup.object({
    destination: yup.string().required(),
    amount: yup
      .string()
      .matches(/\d+(\.\d{1,7})?/)
      .required(),
  }),
});

interface RequestData extends Asserts<typeof RequestSchema> {}

const httpTrigger: AzureFunction = async (
  context: Context,
  req: HttpRequest
): Promise<void> => {
  try {
    const userInfo = await authenticate(req);
    const userAccount = await muxedAccount(userInfo.userId);

    const data: RequestData = RequestSchema.validateSync(req);
    const amountNormalized = BigInt(
      BigDecimal.multiply(data.body.amount, 10 ** 7)
    );

    // check account has sufficient balance
    if (amountNormalized > userInfo.balance) {
      context.res = HttpResponseBuilder.error(
        409,
        "Insuccifient account balance"
      ).build();
      return;
    }

    // check that the destination account exists
    const destination = await loadAccount(data.body.destination);
    if (!destination) {
      context.res = HttpResponseBuilder.error(
        404,
        "Destination not found"
      ).build();
      return;
    }

    // create a balance reservation
    const reservationid = v4();
    let result = await execute(
      "EXEC [Stellar].[ReservePayment] @userid, @reservationid, @amount",
      {
        userid: parseInt(userAccount.id()),
        reservationid: reservationid,
        amount: amountNormalized,
      }
    );

    // make the payment
    result = await makePayment(
      userAccount,
      destination.accountId(),
      data.body.amount
    )
      .then((result) => {
        // payment succeeded, confirm payment
        return execute(
          "EXEC [Stellar].[ConfirmPayment] @reservationid",
          {
            reservationid: reservationid,
          },
          undefined,
          "confirm"
        );
      })
      .catch((error) => {
        // payment failed, cancel reservation
        context.log.error("Payment failed", error);
        return execute(
          "EXEC [Stellar].[CancelPayment] @reservationid",
          {
            reservationid: reservationid,
          },
          undefined,
          "cancel"
        );
      });

    if (result.label === "confirm") {
      context.res = HttpResponseBuilder.noContent().build();
    } else {
      context.res = HttpResponseBuilder.error(500).build();
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      const message = (error as ValidationError).message;
      context.res = HttpResponseBuilder.error(400, message).build();
    } else if (error instanceof AuthenticationError) {
      context.res = HttpResponseBuilder.error(401).build();
    } else {
      context.log.error(error);
      context.res = HttpResponseBuilder.error(500).build();
    }
  }
};

export default httpTrigger;
