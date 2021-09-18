import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Asserts, ValidationError } from "yup";
import * as yup from "yup";
import { authenticate, AuthenticationError } from "../common/auth";
import { HttpResponseBuilder } from "../common/http";
import BigDecimal from "js-big-decimal";
import { makePayment, muxedAccount } from "../common/stellar";
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

    if (amountNormalized > userInfo.balance) {
      context.res = HttpResponseBuilder.error(
        409,
        "Insuccifient account balance"
      ).build();
      return;
    }

    const reservationid = v4();
    await execute(
      "EXEC [Stellar].[ReservePayment] @userid, @reservationid, @amount",
      {
        userid: parseInt(userAccount.id()),
        reservationid: reservationid,
        amount: amountNormalized,
      }
    );

    await makePayment(
      userAccount,
      data.body.destination,
      data.body.amount
    ).catch((error) => {
      execute("EXEC [Stellar].[CancelPayment] @reservationid", {
        reservationid: reservationid,
      });
      throw new Error("Stellar transaction failed");
    });

    await execute("EXEC [Stellar].[ConfirmPayment] @reservationid", {
      reservationid: reservationid,
    });

    context.res = HttpResponseBuilder.noContent().build();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      context.res = HttpResponseBuilder.error(401).build();
    } else {
      context.log.error(error);
      context.res = HttpResponseBuilder.error(500).build();
    }
  }
};

export default httpTrigger;
