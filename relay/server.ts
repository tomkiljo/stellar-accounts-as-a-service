require("dotenv").config();
import { ServiceBusClient, ServiceBusMessage } from "@azure/service-bus";
import express from "express";
import moment from "moment";
import { Server, ServerApi } from "stellar-sdk";

interface RelayStatus {
  account_id: string;

  message_count: number;
  record_count: number;
  relay_count: number;
  error_count: number;

  last_error_at?: string;
  last_message_received_at?: string;
  last_message_relayed_at?: string;
  last_paging_token?: string;

  last_messages: any[];
  last_error?: any;
}

const port = process.env["PORT"] ?? 3000;
const dryRun = !!process.env["DRY_RUN"];

const accountId = process.env["ACCOUNT_ID"]!;
const horizonEndpoint =
  process.env["HORIZON_ENDPOINT"] ?? "https://horizon-testnet.stellar.org";
const reconnectTimeout = parseInt(process.env["RECONNECT_TIMEOUT"] ?? "10000");

const connectionString = process.env["SERVICE_BUS_CONNECTION"]!;
const queueName = process.env["SERVICE_BUS_QUEUE_NAME"]!;

const status: RelayStatus = {
  account_id: accountId,
  message_count: 0,
  record_count: 0,
  relay_count: 0,
  error_count: 0,
  last_messages: [],
};

const timestamp = () => moment.utc().toISOString();

const relayRecords = async (
  records: ServerApi.PaymentOperationRecord[]
): Promise<void> => {
  if (sender && records.length > 0) {
    let batch = await sender.createMessageBatch();
    for (let i = 0; i < records.length; i++) {
      const message: ServiceBusMessage = {
        body: records[i],
      };
      if (!batch.tryAddMessage(message)) await sender.sendMessages(batch);
      batch = await sender.createMessageBatch();
      if (!batch.tryAddMessage(message)) {
        throw new Error("Record too big to fit in a batch");
      }
    }
    await sender.sendMessages(batch);
  }

  console.debug(`${records.length} Stellar record(s) relayed`);
  if (records.length > 0) {
    status.relay_count += 1;
    status.last_message_relayed_at = timestamp();
    status.last_paging_token = records[records.length - 1].paging_token;
  }
};

const shutdown = () => {
  console.info("Relay shutting down...");
  if (sender) {
    sender
      .close()
      .then(() => client?.close())
      .finally(() => process.exit());
  } else {
    process.exit();
  }
};

const app = express();
const server = new Server(horizonEndpoint);
const client = !dryRun ? new ServiceBusClient(connectionString) : undefined;
const sender = client?.createSender(queueName);

app.get("/", (req, res) => {
  res.json(status);
});

app.listen(port, () => {
  server
    .payments()
    .forAccount(accountId)
    .stream({
      reconnectTimeout: reconnectTimeout,
      onmessage: (message) => {
        console.debug("Stellar message received");
        const records = message.records || [message];

        relayRecords(
          records
            .filter((record) => record.type === "payment")
            .filter((record) => record.to === accountId)
            .filter((record) => !!record["to_muxed_id"])
        );

        status.message_count += 1;
        status.record_count += records.length;
        status.last_message_received_at = timestamp();
        status.last_messages.unshift(message);
        if (status.last_messages.length >= 5) {
          status.last_messages.pop();
        }
      },
      onerror: (error) => {
        console.error("Stellar stream error", error);
        status.error_count += 1;
        status.last_error_at = timestamp();
        status.last_error = error;
      },
    });

  console.info(`Relay running at localhost:${port}`);
  console.info(`  stellar account id : ${accountId}`);
  console.info(`  horizon endpoint   : ${horizonEndpoint}`);
  console.info(`  reconnect timeout  : ${reconnectTimeout}`);
  console.info(`  service bus queue  : ${queueName}`);
  console.info("\nShutdown relay with CTRL+C\n");
});

process.once("SIGINT", shutdown);
process.once("SIGUSR2", shutdown);
