import {getAuth} from "firebase-admin/auth";
import * as functions from "firebase-functions";
import * as ethers from "ethers";
import * as YawAdmin from "./YawAdmin.json";
import * as YawWallet from "./YawWallet.json";
import * as YawToken from "./YawToken.json";
import * as ERC20 from "./ERC20.json";
import * as nodemailer from "nodemailer";
import {parseEther} from "ethers/lib/utils";

const secrets = functions.config().doppler;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: secrets.SENDER_EMAIL,
    pass: secrets.SENDER_EMAIL_PASSWORD,
  },
});

const getProvider = function() {
  return new ethers.providers.AlchemyProvider(
      secrets.VITE_HARDHAT_NETWORK,
      secrets.VITE_GOERLI_ALCHEMY_KEY
  );
};

const getSigner = function() {
  return new ethers.Wallet(
      secrets.HARDHAT_ACCOUNT_PRIVATE_KEY || "",
      getProvider()
  );
};

const adminContract = function() {
  return new ethers.Contract(YawAdmin.address, YawAdmin.abi, getSigner());
};

const walletContract = function(contractAddress: string) {
  const signer = getSigner();
  return new ethers.Contract(contractAddress, YawWallet.abi, signer);
};

const genSalt = function(email: string) {
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(`mailto:${email}`));
};

const walletImplAddress = function() {
  return ethers.utils.getCreate2Address(
      YawAdmin.address,
      ethers.constants.HashZero,
      ethers.utils.keccak256(YawWallet.bytecode)
  );
};

const walletAddress = async function(email: string) {
  const contract = new ethers.Contract(
      YawAdmin.address,
      YawAdmin.abi,
      getSigner()
  );
  return await contract.predictWalletAddress(
      walletImplAddress(),
      genSalt(email)
  );
};

const genAddressIfNecessary = async (receiver: string) => {
  if (ethers.utils.isAddress(receiver)) {
    return receiver;
  } else {
    return await walletAddress(receiver);
  }
};

const genERC20SendTxData = (to: string, amount: ethers.BigNumber) => {
  const iface = new ethers.utils.Interface(ERC20.abi);
  return iface.encodeFunctionData("transfer", [to, amount]);
};

const normalizeAmountToSend = (amount: number, decimals: number) => {
  const factor = ethers.BigNumber.from(10).pow(decimals);
  return factor.mul(amount);
};

const notify = async (dest: string, subject: string, content: string) => {
  const mailOptions = {
    from: `Yaw <${secrets.SENDER_EMAIL}>`,
    to: dest,
    subject, // email subject
    html: `<p style="font-size: 16px;">${content}</p>`,
  };
  await transporter.sendMail(mailOptions);
};

const validateUser = async function(context: any) {
  const uid = context.auth?.uid;
  if (!uid) {
    return {code: 401, message: "Unauthorized"};
  }
  const user = await getAuth().getUser(uid);
  if (user.email) {
    return {success: true, email: user.email, user: user};
  } else {
    return {code: 400, message: "Email not set"};
  }
};

export const metadata = functions.https.onCall(async (_data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    return {code: 401, message: "Unauthorized"};
  }

  const user = await getAuth().getUser(uid);
  if (user.email) {
    return {
      code: 200,
      admin: YawAdmin.address,
      walletImpl: walletImplAddress(),
      token: YawToken.address,
      wallet: await walletAddress(user.email),
      abi: {
        admin: YawAdmin.abi,
        wallet: YawWallet.abi,
        token: YawToken.abi,
      },
      balance: 0,
    };
  } else {
    return {code: 400, message: "Email not set"};
  }
});

export const deployWallet = functions.https.onCall(async (_data, context) => {
  const result = await validateUser(context);
  if (!result.success) {
    return {code: result.code, message: result.message};
  }
  const {email} = result;
  const yawAdmin = adminContract();
  const tx = await yawAdmin.clone(walletImplAddress(), genSalt(email));
  return {code: 200, txHash: tx.hash};
});

export const sendETH = functions.https.onCall(async (data, context) => {
  const result = await validateUser(context);
  if (!result.success) {
    return {code: result.code, message: result.message};
  }
  const {email, user} = result;
  const yawWallet = walletContract(await walletAddress(email));
  const receiver = await genAddressIfNecessary(data.receiver);
  const tx = await yawWallet.execute(
      receiver,
      parseEther(data.amount.toString()),
      50000,
      [],
  );
  if (!ethers.utils.isAddress(data.receiver)) {
    await notify(
        data.receiver,
        "[YAW] Token Received",
        `${user.displayName} just sent you ${data.amount} ETH.`
    );
  }
  return {code: 200, txHash: tx.hash};
});

export const sendERC20 = functions.https.onCall(async (data, context) => {
  const result = await validateUser(context);
  if (!result.success) {
    return {code: result.code, message: result.message};
  }
  const {email, user} = result;
  const yawWallet = walletContract(await walletAddress(email));
  const receiver = await genAddressIfNecessary(data.receiver);
  const amount = normalizeAmountToSend(data.amount, data.token.decimals);
  const tx = await yawWallet.execute(
      data.token.contract,
      0, // value
      65000, // gas
      genERC20SendTxData(receiver, amount),
  );
  if (!ethers.utils.isAddress(data.receiver)) {
    await notify(
        data.receiver,
        "[YAW] Token Received",
        // eslint-disable-next-line max-len
        `${user.displayName} just sent you ${data.amount} ${data.token.symbol}.`
    );
  }
  return {code: 200, txHash: tx.hash};
});

export const executeTx = functions.https.onCall(async (data, context) => {
  const result = await validateUser(context);
  if (!result.success) {
    return {code: result.code, message: result.message};
  }
  const {email} = result;
  const yawWallet = walletContract(await walletAddress(email));
  const tx = await yawWallet.execute(
      data.contract,
      data.amount,
      data.txGas,
      data.txData,
  );
  return {code: 200, txHash: tx.hash};
});

export const estimateERC20Transfer = functions.https.onCall(
    async (data, context) => {
      const result = await validateUser(context);
      if (!result.success) {
        return {code: result.code, message: result.message};
      }
      const {email} = result;

      const provider = getProvider();
      const feeData = await provider.getFeeData();

      const yawWallet = walletContract(await walletAddress(email));
      const receiver = await genAddressIfNecessary(data.receiver);
      const amount = normalizeAmountToSend(data.amount, data.token.decimals);
      const gasCost = await yawWallet.estimateGas.execute(
          data.token.contract,
          0, // value
          65000, // gas
          genERC20SendTxData(receiver, amount),
      );
      const baseFeePerGas = feeData.maxFeePerGas?.sub(
          feeData.maxPriorityFeePerGas || 0
      ) || 0;
      return {
        baseCost: gasCost.mul(baseFeePerGas || 0),
        maxCost: gasCost.mul(feeData.maxFeePerGas || 0),
      };
    }
);

export const estimateETHTransfer = functions.https.onCall(
    async (_data, context) => {
      const result = await validateUser(context);
      if (!result.success) {
        return {code: result.code, message: result.message};
      }
      const provider = getProvider();
      const feeData = await provider.getFeeData();
      const baseFeePerGas = feeData.maxFeePerGas?.sub(
          feeData.maxPriorityFeePerGas || 0
      ) || 0;
      const gasCost = ethers.BigNumber.from(23000);
      return {
        baseCost: gasCost.mul(baseFeePerGas || 0),
        maxCost: gasCost.mul(feeData.maxFeePerGas || 0),
      };
    }
);