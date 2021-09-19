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
  // process payment, only has effect on balance if
  // - operation has not been processed before; and
  // - the target user account exists
  const amountNormalized = BigInt(BigDecimal.multiply(payment.amount, 10 ** 7));
  await execute(
    "EXEC [Stellar].[ProcessDeposit] @userid, @amount, @operationId, @transactionHash",
    {
      userid: parseInt(muxedId),
      amount: amountNormalized,
      operationId: payment.id,
      transactionHash: payment.transaction_hash,
    }
  );
};

export default serviceBusQueueTrigger;
