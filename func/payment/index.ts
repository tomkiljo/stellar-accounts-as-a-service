import { AzureFunction, Context } from "@azure/functions";
import { ServerApi } from "stellar-sdk";
import { execute } from "../common/database";
import BigDecimal from "js-big-decimal";

const serviceBusQueueTrigger: AzureFunction = async (
  context: Context,
  operation: any
): Promise<void> => {
  context.log("Service Bus message received", operation);
  // only handle payment operations
  if (operation.type !== "payment") {
    context.log.info("received an operation that is not a payment");
    return;
  }
  // only handle payments in native assets
  const payment = operation as ServerApi.PaymentOperationRecord;
  if (payment.asset_type !== "native") {
    context.log.info("only native assets are supported");
    return;
  }
  // only handle payments for muxed accounts
  const muxedId = payment["to_muxed_id"];
  if (!muxedId) {
    context.log.info("payment not for a muxed account");
    return;
  }

  const amount = BigInt(BigDecimal.multiply(payment.amount, 10 ** 7));

  // TODO idempotent operation handling
  const updateQuery = `
    UPDATE TOP (1) [Stellar].[Users]
    SET [Balance] = [Balance] + @amount
    WHERE [UserID] = @userid
  `;

  const result = await execute(updateQuery, {
    userid: parseInt(muxedId),
    amount: amount,
  });
  if (result.rowCount === 1) {
    context.log.info(
      `payment of ${amount}XLM for account id ${muxedId} processed`
    );
  } else {
    context.log.warn(
      `payment of ${payment.amount} XLM for account id ${muxedId} not processed, account not found`
    );
  }
};

export default serviceBusQueueTrigger;
