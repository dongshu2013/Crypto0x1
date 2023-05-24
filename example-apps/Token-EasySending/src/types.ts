import type { BigNumber as EthersBigNumber } from "ethers";


export interface IUser {
    provider: string;
    idType: string;
    name: string;
    handle: string,
    uid: string;
    email?: string;
    providerUid: string;
    displayName?: string;
    photoURL?: string;
    idToken: string;
}
  
export interface IAuth {
    authenticated: boolean,
    user?: IUser,
    returnUrl?: string,
}