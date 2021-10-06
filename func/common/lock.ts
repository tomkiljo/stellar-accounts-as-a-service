import { BlobServiceClient } from "@azure/storage-blob";
import { v4 } from "uuid";
import { custodianAccountId } from "./stellar";

const leaseDurationSeconds = 15;
const containerName = "stellar-payment-locks";
const blockBlobName = custodianAccountId();

const connectionString = process.env["PAYMENT_LOCK_CONNECTION"]!;
const blobServiceClient =
  BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);
const blockBlobClient = containerClient.getBlockBlobClient(blockBlobName);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const acquirePaymentLock = async (): Promise<string | undefined> => {
  if (!(await blockBlobClient.exists())) {
    await containerClient.createIfNotExists();
    await blockBlobClient.uploadData(Buffer.of());
  }

  const blobLeaseClient = blockBlobClient.getBlobLeaseClient(v4());
  for (let i = 0; i < 5; i++) {
    const leaseId = await blobLeaseClient
      .acquireLease(leaseDurationSeconds)
      .then((res) => res.leaseId)
      .catch((err) => undefined);
    if (leaseId) {
      return leaseId;
    }
    await sleep(3000);
  }

  return undefined;
};

export const releasePaymentLock = async (leaseId: string): Promise<void> => {
  const blobLeaseClient = blockBlobClient.getBlobLeaseClient(leaseId);
  return blobLeaseClient
    .releaseLease()
    .then((res) => undefined)
    .catch((err) => undefined);
};
