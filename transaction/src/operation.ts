import {ethers, BigNumber as EthBigNumber, PopulatedTransaction } from "ethers";
import {insertRedPacketClaim, insertRedPacket} from "./graphql/redpacket";
import type {Chain} from "../../functions/common";
import {PriceConfigs, parseDeposit} from "../../functions/common";
import {
  parseDeployed,
  parseClaimed,
  parseCreated,
  redPacketAddress,
  hexlinkErc721Contract,
  hexlinkErc721Metadata,
} from "../../functions/redpacket";
import type {Action, Operation} from "./types";
import {updateOp} from "./graphql/operation";
import { getInfuraProvider } from "./utils";

export async function buildTx(
  provider: ethers.providers.Provider,
  chain: Chain,
  unsignedTx: PopulatedTransaction,
  from: string
) : Promise<ethers.PopulatedTransaction> {
  const {chainId} = await provider.getNetwork();
  unsignedTx.chainId = chainId;
  unsignedTx.from = from;
  unsignedTx.type = 2;
  unsignedTx.nonce = await provider.getTransactionCount(unsignedTx.from);
  const feeData = await provider.getFeeData();
  unsignedTx.maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas || EthBigNumber.from(0);
  unsignedTx.maxFeePerGas = feeData.maxFeePerGas ||
    EthBigNumber.from(PriceConfigs[chain.name]);
  return unsignedTx;
}

async function processAction(
  op: Operation,
  chain: Chain,
  action: Action,
  receipt: ethers.providers.TransactionReceipt
) {
  const params = action.params;
  if (action.type === "insert_redpacket_claim") {
    const claimed = parseClaimed(
      chain,
      receipt,
      params.redPacketId,
      op.account,
    );
    if (claimed !== undefined) {
      await insertRedPacketClaim([{
        ...params,
        claimed,
        opId: op.id,
      }]);
    } else {
      console.log("redpacket claim not found: " + params.redPacketId);
      await updateOp(op.id, undefined, "claim event not found");
    }
  }

  if (action.type === "insert_redpacket") {
    const created = parseCreated(
      chain,
      receipt,
      params.redPacketId,
    );
    if (created !== undefined) {
      const deposit = parseDeposit(
        receipt,
        params.redPacketId,
        op.account,
        params.refunder,
      );
      await insertRedPacket(
        params.userId,
        [{
          id: params.redPacketId,
          type: "erc20",
          creator: params.creator,
          userId: op.userId,
          metadata: {
            token: created.packet.token,
            balance: created.packet.balance.toString(),
            split: created.packet.split,
            salt: created.packet.salt,
            validator: created.packet.validator,
            mode: created.packet.mode,
            creator: created.creator,
            contract: redPacketAddress(chain),
          },
          opId: op.id,
          deposit: {
            receipt: deposit?.receipt,
            token: deposit?.token,
            amount: deposit?.amount.toString(),
            priceInfo: params.priceInfo,
          },
        }]
      );
    } else {
      console.log("redpacket not found: " + params.redPacketId);
      await updateOp(op.id, undefined, "redpacket event not found");
    }
  }

  if (action.type === "insert_redpacket_erc721") {
    const deployed = parseDeployed(
      chain,
      receipt,
      op.account,
      params.salt,
    );
    if (deployed !== undefined) {
      const deposit = parseDeposit(
        receipt,
        params.redPacketId,
        op.account,
        params.refunder,
      );
      const metadata = await hexlinkErc721Metadata(
        await hexlinkErc721Contract(
          deployed.deployed,
          getInfuraProvider(chain)
        )
      );
      await insertRedPacket(
        params.userId,
        [{
          id: params.redPacketId,
          creator: params.creator,
          userId: op.userId,
          type: "erc721",
          metadata: {
            token: deployed.deployed,
            salt: deployed.salt,
            creator: deployed.creator,
            ...metadata,
          },
          opId: op.id,
          deposit: {
            receipt: deposit?.receipt,
            token: deposit?.token,
            amount: deposit?.amount.toString(),
            priceInfo: params.priceInfo,
          },
        }]
      )
    }
  }
}

export async function processActions(
  chain: Chain,
  op: Operation,
  receipt: ethers.providers.TransactionReceipt
) {
  await Promise.all(
    op.actions.map(
      action => processAction(op, chain, action, receipt)
    )
  );
}