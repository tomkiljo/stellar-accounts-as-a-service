import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Asserts, ValidationError } from "yup";
import * as yup from "yup";
import { authenticate, AuthenticationError } from "../common/auth";
import { HttpResponseBuilder } from "../common/http";
import BigDecimal from "js-big-decimal";
import { accountExists, makePayment, muxedAccount } from "../common/stellar";
import { execute } from "../common/database";
import { v4 } from "uuid";
import { acquirePaymentLock, releasePaymentLock } from "../common/lock";
import { string } from "yup/lib/locale";

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
  let paymentLock: string | undefined;

  try {
    const userInfo = await authenticate(req);
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
    if (!(await accountExists(data.body.destination))) {
      context.res = HttpResponseBuilder.error(
        404,
        "Destination not found"
      ).build();
      return;
    }

    // acquire payment lock
    paymentLock = await acquirePaymentLock();
    if (!paymentLock) {
      context.res = HttpResponseBuilder.error(
        504,
        "Unable to acquire payment lock"
      ).build();
      return;
    }

    context.log("payment lock acquired");

    // create a balance reservation
    const reservationid = v4();
    let result = await execute(
      "EXEC [Stellar].[ReservePayment] @userid, @reservationid, @amount",
      {
        userid: userInfo.userId,
        reservationid: reservationid,
        amount: amountNormalized,
      }
    );

    // make the payment
    result = await makePayment(
      userInfo.userId,
      data.body.destination,
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
  } finally {
    if (paymentLock) {
      await releasePaymentLock(paymentLock);
      context.log("payment lock released");
    }
  }
};

export default httpTrigger;
