import { Account, Asset, Keypair, MuxedAccount } from "stellar-base";
import {
  AccountResponse,
  Horizon,
  Networks,
  Operation,
  Server,
  TransactionBuilder,
} from "stellar-sdk";

const server = new Server("https://horizon-testnet.stellar.org");
const custodian = Keypair.fromSecret(process.env["CUSTODIAN_SECRET"]!);

const fetchCustodian = async (): Promise<Account> => {
  return await server.loadAccount(custodian.publicKey());
};

export const custodianAccountId = () => {
  return custodian.publicKey();
};

export const makePayment = async (
  userId: number,
  destination: string,
  amount: string
): Promise<Horizon.SubmitTransactionResponse> => {
  const fee = await server.fetchBaseFee();
  const options = {
    networkPassphrase: Networks.TESTNET,
    fee: fee.toString(),
    withMuxing: true,
  };

  const sender = await muxedAccount(userId);
  const transaction = new TransactionBuilder(sender.baseAccount(), options)
    .addOperation(
      Operation.payment({
        source: sender.accountId(),
        destination: destination,
        asset: Asset.native(),
        amount: amount,
        withMuxing: true,
      })
    )
    .setTimeout(30)
    .build();

  transaction.sign(custodian);
  return server.submitTransaction(transaction);
};

export const muxedAccount = async (id: number): Promise<MuxedAccount> => {
  const custodian = await fetchCustodian();
  return new MuxedAccount(custodian, id.toString());
};

export const loadAccount = (
  accountId: string
): Promise<AccountResponse | undefined> => {
  return server.loadAccount(accountId).catch((error) => {
    return undefined;
  });
};

export const accountExists = (accountId: string): Promise<boolean> => {
  const baseAddress = accountId.startsWith("M")
    ? MuxedAccount.fromAddress(accountId, "0").baseAccount().accountId()
    : accountId;
  return loadAccount(baseAddress).then((res) => !!res);
};
