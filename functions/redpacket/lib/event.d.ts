import { ethers, BigNumber as EthBigNumber } from "ethers";
import type { Chain } from "../../common";
import type { TransactionReceipt } from "@ethersproject/providers";
import type { RedPacket, RedPacketErc721 } from "./types";
export declare function parseClaimed(chain: Chain, receipt: TransactionReceipt, packetId: string, claimer: string): EthBigNumber | undefined;
export declare function parseCreated(chain: Chain, receipt: TransactionReceipt, packetId: string): ethers.utils.Result;
export declare function redpacketId(chain: Chain, account: string, input: RedPacket): string;
export declare function redpacketErc721Id(chain: Chain, account: string, input: RedPacketErc721): string;
export declare function parseDeployed(chain: Chain, receipt: TransactionReceipt, creator: string, salt: string): ethers.utils.Result;
