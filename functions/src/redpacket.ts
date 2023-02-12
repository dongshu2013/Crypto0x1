/* eslint-disable require-jsdoc */
import * as functions from "firebase-functions";

import {getRedPacket} from "./graphql/redpacket";
import type {RedPacket} from "./graphql/redpacket";
import {signWithKmsKey} from "./kms";
import {ethers} from "ethers";
import {toEthSignedMessageHash} from "./account";
import {KMS_KEY_TYPE, kmsConfig} from "./config";

import {
  redPacketAddress,
  redPacketInterface,
  redpacketId,
  redpacketErc721Id,
  tokenFactoryAddress,
} from "../redpacket";
import {refunder} from "../common";
import type {Chain, OpInput} from "../common";
import {submit} from "./services/operation";
import {insertRequest} from "./graphql/request";
import {RequestData, preprocess, validateAndBuildUserOp} from "./operation";

const secrets = functions.config().doppler || {};

async function sign(signer: string, message: string) : Promise<string> {
  const validator = new ethers.Wallet(secrets.HARDHAT_VALIDATOR);
  if (signer.toLowerCase() == validator.address.toLowerCase()) {
    return await validator.signMessage(ethers.utils.arrayify(message));
  } else {
    const keyType = KMS_KEY_TYPE[KMS_KEY_TYPE.validator];
    const kmsValidator = kmsConfig().get(keyType)!.publicAddress;
    if (signer.toLowerCase() == kmsValidator.toLowerCase()) {
      return await signWithKmsKey(
          keyType,
          toEthSignedMessageHash(message)
      ) as string;
    } else {
      throw new Error("invalid validator");
    }
  }
}

async function buildClaimOp(
    chain: Chain,
    redPacket: RedPacket,
    claimer: string,
) : Promise<OpInput> {
  const message = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
          ["bytes32", "address"],
          [redPacket.id, claimer]
      )
  );
  const signature = await sign(redPacket.metadata.validator, message);
  const args = {
    creator: redPacket.metadata.creator,
    packet: {
      token: redPacket.metadata.token,
      salt: redPacket.metadata.salt,
      balance: redPacket.metadata.balance,
      validator: redPacket.metadata.validator,
      split: redPacket.metadata.split,
      mode: redPacket.metadata.mode,
    },
    claimer,
    signature,
  };
  return {
    to: redPacketAddress(chain),
    value: "0x0",
    callData: redPacketInterface.encodeFunctionData("claim", [args]),
    callGasLimit: "0x0",
  };
}

export const claimRedPacket = functions.https.onCall(
    async (data, context) => {
      const result = await preprocess(data, context);
      if (result.code !== 200) {
        return result;
      }
      const {uid, account, chain} = result as RequestData;

      const redPacket = await getRedPacket(data.redPacketId);
      if (!redPacket) {
        return {code: 400, message: "Failed to load redpacket"};
      }

      const input = await buildClaimOp(chain, redPacket, account.address);
      const action = {
        type: "insert_redpacket_claim",
        params: {
          redPacketId: redPacket.id,
          creatorId: redPacket.user_id,
          claimerId: uid,
          claimer: data.claimer,
        },
      };
      const [{id: reqId}] = await insertRequest(
          uid,
          [{
            to: redPacketAddress(chain),
            args: {
              redPacketId: redPacket.id,
            },
          }]
      );
      const resp = await submit(chain, {
        type: "claim_redpacket",
        input,
        account: account.address,
        userId: uid,
        actions: [action],
        requestId: reqId,
      });
      return {code: 200, id: resp.id};
    }
);

export const createRedPacket = functions.https.onCall(
    async (data, context) => {
      const result = await preprocess(data, context);
      if (result.code !== 200) {
        return result;
      }
      const {uid, account, chain} = result as RequestData;

      const rpId = redpacketId(chain, account.address, data.redPacket);
      const action = {
        type: "insert_redpacket",
        params: {
          userId: uid,
          redPacketId: rpId,
          creator: data.creator,
          refunder: refunder(chain),
          priceInfo: data.redPacket.priceInfo,
        },
      };
      const [{id: reqId}] = await insertRequest(
          uid,
          [{
            to: redPacketAddress(chain),
            args: {
              redPacketId: rpId,
              metadata: data.redPacket,
            },
          }]
      );
      const postData: any = {
        type: "create_redpacket",
        userId: uid,
        actions: [action],
        account: account.address,
        requestId: reqId,
      };
      if (data.txHash) {
        postData.tx = data.txHash;
      } else {
        postData.input = await validateAndBuildUserOp(
            chain, account, data.request
        );
      }
      const resp = await submit(chain, postData);
      return {code: 200, id: resp.id};
    }
);

export const createRedPacketErc721 = functions.https.onCall(
    async (data, context) => {
      const result = await preprocess(data, context);
      if (result.code !== 200) {
        return result;
      }
      const {uid, account, chain} = result as RequestData;

      const rpId = redpacketErc721Id(chain, account.address, data.erc721);
      const action = {
        type: "insert_redpacket_erc721",
        params: {
          userId: uid,
          redPacketId: rpId,
          salt: data.erc721.salt,
          creator: data.creator,
          refunder: refunder(chain),
          priceInfo: data.redPacket.priceInfo,
        },
      };
      const [{id: reqId}] = await insertRequest(
          uid,
          [{
            to: tokenFactoryAddress(chain),
            args: data.erc721,
          }]
      );
      const postData: any = {
        type: "create_redpacket_erc721",
        userId: uid,
        actions: [action],
        account: account.address,
        requestId: reqId,
      };
      if (data.txHash) {
        postData.tx = data.txHash;
      } else {
        postData.input = await validateAndBuildUserOp(
            chain, account, data.request
        );
      }
      const resp = await submit(chain, postData);
      return {code: 200, id: resp.id};
    }
);
