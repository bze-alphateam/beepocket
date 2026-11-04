// Copied from @bze/bzejs 3.2.0 (src/cosmos/distribution/v1beta1/tx.ts); registry stand-in used, see README. Do not edit; re-copy on chain upgrades.
//@ts-nocheck
import { Coin, CoinAmino, CoinSDKType } from "../../base/v1beta1/coin";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { GlobalDecoderRegistry } from "../../../registry";
/**
 * MsgSetWithdrawAddress sets the withdraw address for
 * a delegator (or validator self-delegation).
 * @name MsgSetWithdrawAddress
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddress
 */
export interface MsgSetWithdrawAddress {
  delegatorAddress: string;
  withdrawAddress: string;
}
export interface MsgSetWithdrawAddressProtoMsg {
  typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress";
  value: Uint8Array;
}
/**
 * MsgSetWithdrawAddress sets the withdraw address for
 * a delegator (or validator self-delegation).
 * @name MsgSetWithdrawAddressAmino
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddress
 */
export interface MsgSetWithdrawAddressAmino {
  delegator_address?: string;
  withdraw_address?: string;
}
export interface MsgSetWithdrawAddressAminoMsg {
  type: "cosmos-sdk/MsgModifyWithdrawAddress";
  value: MsgSetWithdrawAddressAmino;
}
/**
 * MsgSetWithdrawAddress sets the withdraw address for
 * a delegator (or validator self-delegation).
 * @name MsgSetWithdrawAddressSDKType
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddress
 */
export interface MsgSetWithdrawAddressSDKType {
  delegator_address: string;
  withdraw_address: string;
}
/**
 * MsgSetWithdrawAddressResponse defines the Msg/SetWithdrawAddress response
 * type.
 * @name MsgSetWithdrawAddressResponse
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse
 */
export interface MsgSetWithdrawAddressResponse {}
export interface MsgSetWithdrawAddressResponseProtoMsg {
  typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse";
  value: Uint8Array;
}
/**
 * MsgSetWithdrawAddressResponse defines the Msg/SetWithdrawAddress response
 * type.
 * @name MsgSetWithdrawAddressResponseAmino
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse
 */
export interface MsgSetWithdrawAddressResponseAmino {}
export interface MsgSetWithdrawAddressResponseAminoMsg {
  type: "cosmos-sdk/MsgSetWithdrawAddressResponse";
  value: MsgSetWithdrawAddressResponseAmino;
}
/**
 * MsgSetWithdrawAddressResponse defines the Msg/SetWithdrawAddress response
 * type.
 * @name MsgSetWithdrawAddressResponseSDKType
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse
 */
export interface MsgSetWithdrawAddressResponseSDKType {}
/**
 * MsgWithdrawDelegatorReward represents delegation withdrawal to a delegator
 * from a single validator.
 * @name MsgWithdrawDelegatorReward
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
 */
export interface MsgWithdrawDelegatorReward {
  delegatorAddress: string;
  validatorAddress: string;
}
export interface MsgWithdrawDelegatorRewardProtoMsg {
  typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward";
  value: Uint8Array;
}
/**
 * MsgWithdrawDelegatorReward represents delegation withdrawal to a delegator
 * from a single validator.
 * @name MsgWithdrawDelegatorRewardAmino
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
 */
export interface MsgWithdrawDelegatorRewardAmino {
  delegator_address?: string;
  validator_address?: string;
}
export interface MsgWithdrawDelegatorRewardAminoMsg {
  type: "cosmos-sdk/MsgWithdrawDelegationReward";
  value: MsgWithdrawDelegatorRewardAmino;
}
/**
 * MsgWithdrawDelegatorReward represents delegation withdrawal to a delegator
 * from a single validator.
 * @name MsgWithdrawDelegatorRewardSDKType
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
 */
export interface MsgWithdrawDelegatorRewardSDKType {
  delegator_address: string;
  validator_address: string;
}
/**
 * MsgWithdrawDelegatorRewardResponse defines the Msg/WithdrawDelegatorReward
 * response type.
 * @name MsgWithdrawDelegatorRewardResponse
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse
 */
export interface MsgWithdrawDelegatorRewardResponse {
  /**
   * Since: cosmos-sdk 0.46
   */
  amount: Coin[];
}
export interface MsgWithdrawDelegatorRewardResponseProtoMsg {
  typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse";
  value: Uint8Array;
}
/**
 * MsgWithdrawDelegatorRewardResponse defines the Msg/WithdrawDelegatorReward
 * response type.
 * @name MsgWithdrawDelegatorRewardResponseAmino
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse
 */
export interface MsgWithdrawDelegatorRewardResponseAmino {
  /**
   * Since: cosmos-sdk 0.46
   */
  amount: CoinAmino[];
}
export interface MsgWithdrawDelegatorRewardResponseAminoMsg {
  type: "cosmos-sdk/MsgWithdrawDelegatorRewardResponse";
  value: MsgWithdrawDelegatorRewardResponseAmino;
}
/**
 * MsgWithdrawDelegatorRewardResponse defines the Msg/WithdrawDelegatorReward
 * response type.
 * @name MsgWithdrawDelegatorRewardResponseSDKType
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse
 */
export interface MsgWithdrawDelegatorRewardResponseSDKType {
  amount: CoinSDKType[];
}
function createBaseMsgSetWithdrawAddress(): MsgSetWithdrawAddress {
  return {
    delegatorAddress: "",
    withdrawAddress: ""
  };
}
/**
 * MsgSetWithdrawAddress sets the withdraw address for
 * a delegator (or validator self-delegation).
 * @name MsgSetWithdrawAddress
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddress
 */
export const MsgSetWithdrawAddress = {
  typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
  aminoType: "cosmos-sdk/MsgModifyWithdrawAddress",
  is(o: any): o is MsgSetWithdrawAddress {
    return o && (o.$typeUrl === MsgSetWithdrawAddress.typeUrl || typeof o.delegatorAddress === "string" && typeof o.withdrawAddress === "string");
  },
  isSDK(o: any): o is MsgSetWithdrawAddressSDKType {
    return o && (o.$typeUrl === MsgSetWithdrawAddress.typeUrl || typeof o.delegator_address === "string" && typeof o.withdraw_address === "string");
  },
  isAmino(o: any): o is MsgSetWithdrawAddressAmino {
    return o && (o.$typeUrl === MsgSetWithdrawAddress.typeUrl || typeof o.delegator_address === "string" && typeof o.withdraw_address === "string");
  },
  encode(message: MsgSetWithdrawAddress, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.delegatorAddress !== "") {
      writer.uint32(10).string(message.delegatorAddress);
    }
    if (message.withdrawAddress !== "") {
      writer.uint32(18).string(message.withdrawAddress);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSetWithdrawAddress {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSetWithdrawAddress();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.delegatorAddress = reader.string();
          break;
        case 2:
          message.withdrawAddress = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgSetWithdrawAddress>): MsgSetWithdrawAddress {
    const message = createBaseMsgSetWithdrawAddress();
    message.delegatorAddress = object.delegatorAddress ?? "";
    message.withdrawAddress = object.withdrawAddress ?? "";
    return message;
  },
  fromAmino(object: MsgSetWithdrawAddressAmino): MsgSetWithdrawAddress {
    const message = createBaseMsgSetWithdrawAddress();
    if (object.delegator_address !== undefined && object.delegator_address !== null) {
      message.delegatorAddress = object.delegator_address;
    }
    if (object.withdraw_address !== undefined && object.withdraw_address !== null) {
      message.withdrawAddress = object.withdraw_address;
    }
    return message;
  },
  toAmino(message: MsgSetWithdrawAddress): MsgSetWithdrawAddressAmino {
    const obj: any = {};
    obj.delegator_address = message.delegatorAddress === "" ? undefined : message.delegatorAddress;
    obj.withdraw_address = message.withdrawAddress === "" ? undefined : message.withdrawAddress;
    return obj;
  },
  fromAminoMsg(object: MsgSetWithdrawAddressAminoMsg): MsgSetWithdrawAddress {
    return MsgSetWithdrawAddress.fromAmino(object.value);
  },
  toAminoMsg(message: MsgSetWithdrawAddress): MsgSetWithdrawAddressAminoMsg {
    return {
      type: "cosmos-sdk/MsgModifyWithdrawAddress",
      value: MsgSetWithdrawAddress.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgSetWithdrawAddressProtoMsg): MsgSetWithdrawAddress {
    return MsgSetWithdrawAddress.decode(message.value);
  },
  toProto(message: MsgSetWithdrawAddress): Uint8Array {
    return MsgSetWithdrawAddress.encode(message).finish();
  },
  toProtoMsg(message: MsgSetWithdrawAddress): MsgSetWithdrawAddressProtoMsg {
    return {
      typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
      value: MsgSetWithdrawAddress.encode(message).finish()
    };
  },
  registerTypeUrl() {}
};
function createBaseMsgSetWithdrawAddressResponse(): MsgSetWithdrawAddressResponse {
  return {};
}
/**
 * MsgSetWithdrawAddressResponse defines the Msg/SetWithdrawAddress response
 * type.
 * @name MsgSetWithdrawAddressResponse
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse
 */
export const MsgSetWithdrawAddressResponse = {
  typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse",
  aminoType: "cosmos-sdk/MsgSetWithdrawAddressResponse",
  is(o: any): o is MsgSetWithdrawAddressResponse {
    return o && o.$typeUrl === MsgSetWithdrawAddressResponse.typeUrl;
  },
  isSDK(o: any): o is MsgSetWithdrawAddressResponseSDKType {
    return o && o.$typeUrl === MsgSetWithdrawAddressResponse.typeUrl;
  },
  isAmino(o: any): o is MsgSetWithdrawAddressResponseAmino {
    return o && o.$typeUrl === MsgSetWithdrawAddressResponse.typeUrl;
  },
  encode(_: MsgSetWithdrawAddressResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSetWithdrawAddressResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgSetWithdrawAddressResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(_: Partial<MsgSetWithdrawAddressResponse>): MsgSetWithdrawAddressResponse {
    const message = createBaseMsgSetWithdrawAddressResponse();
    return message;
  },
  fromAmino(_: MsgSetWithdrawAddressResponseAmino): MsgSetWithdrawAddressResponse {
    const message = createBaseMsgSetWithdrawAddressResponse();
    return message;
  },
  toAmino(_: MsgSetWithdrawAddressResponse): MsgSetWithdrawAddressResponseAmino {
    const obj: any = {};
    return obj;
  },
  fromAminoMsg(object: MsgSetWithdrawAddressResponseAminoMsg): MsgSetWithdrawAddressResponse {
    return MsgSetWithdrawAddressResponse.fromAmino(object.value);
  },
  toAminoMsg(message: MsgSetWithdrawAddressResponse): MsgSetWithdrawAddressResponseAminoMsg {
    return {
      type: "cosmos-sdk/MsgSetWithdrawAddressResponse",
      value: MsgSetWithdrawAddressResponse.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgSetWithdrawAddressResponseProtoMsg): MsgSetWithdrawAddressResponse {
    return MsgSetWithdrawAddressResponse.decode(message.value);
  },
  toProto(message: MsgSetWithdrawAddressResponse): Uint8Array {
    return MsgSetWithdrawAddressResponse.encode(message).finish();
  },
  toProtoMsg(message: MsgSetWithdrawAddressResponse): MsgSetWithdrawAddressResponseProtoMsg {
    return {
      typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddressResponse",
      value: MsgSetWithdrawAddressResponse.encode(message).finish()
    };
  },
  registerTypeUrl() {}
};
function createBaseMsgWithdrawDelegatorReward(): MsgWithdrawDelegatorReward {
  return {
    delegatorAddress: "",
    validatorAddress: ""
  };
}
/**
 * MsgWithdrawDelegatorReward represents delegation withdrawal to a delegator
 * from a single validator.
 * @name MsgWithdrawDelegatorReward
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
 */
export const MsgWithdrawDelegatorReward = {
  typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
  aminoType: "cosmos-sdk/MsgWithdrawDelegationReward",
  is(o: any): o is MsgWithdrawDelegatorReward {
    return o && (o.$typeUrl === MsgWithdrawDelegatorReward.typeUrl || typeof o.delegatorAddress === "string" && typeof o.validatorAddress === "string");
  },
  isSDK(o: any): o is MsgWithdrawDelegatorRewardSDKType {
    return o && (o.$typeUrl === MsgWithdrawDelegatorReward.typeUrl || typeof o.delegator_address === "string" && typeof o.validator_address === "string");
  },
  isAmino(o: any): o is MsgWithdrawDelegatorRewardAmino {
    return o && (o.$typeUrl === MsgWithdrawDelegatorReward.typeUrl || typeof o.delegator_address === "string" && typeof o.validator_address === "string");
  },
  encode(message: MsgWithdrawDelegatorReward, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.delegatorAddress !== "") {
      writer.uint32(10).string(message.delegatorAddress);
    }
    if (message.validatorAddress !== "") {
      writer.uint32(18).string(message.validatorAddress);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgWithdrawDelegatorReward {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgWithdrawDelegatorReward();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.delegatorAddress = reader.string();
          break;
        case 2:
          message.validatorAddress = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgWithdrawDelegatorReward>): MsgWithdrawDelegatorReward {
    const message = createBaseMsgWithdrawDelegatorReward();
    message.delegatorAddress = object.delegatorAddress ?? "";
    message.validatorAddress = object.validatorAddress ?? "";
    return message;
  },
  fromAmino(object: MsgWithdrawDelegatorRewardAmino): MsgWithdrawDelegatorReward {
    const message = createBaseMsgWithdrawDelegatorReward();
    if (object.delegator_address !== undefined && object.delegator_address !== null) {
      message.delegatorAddress = object.delegator_address;
    }
    if (object.validator_address !== undefined && object.validator_address !== null) {
      message.validatorAddress = object.validator_address;
    }
    return message;
  },
  toAmino(message: MsgWithdrawDelegatorReward): MsgWithdrawDelegatorRewardAmino {
    const obj: any = {};
    obj.delegator_address = message.delegatorAddress === "" ? undefined : message.delegatorAddress;
    obj.validator_address = message.validatorAddress === "" ? undefined : message.validatorAddress;
    return obj;
  },
  fromAminoMsg(object: MsgWithdrawDelegatorRewardAminoMsg): MsgWithdrawDelegatorReward {
    return MsgWithdrawDelegatorReward.fromAmino(object.value);
  },
  toAminoMsg(message: MsgWithdrawDelegatorReward): MsgWithdrawDelegatorRewardAminoMsg {
    return {
      type: "cosmos-sdk/MsgWithdrawDelegationReward",
      value: MsgWithdrawDelegatorReward.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgWithdrawDelegatorRewardProtoMsg): MsgWithdrawDelegatorReward {
    return MsgWithdrawDelegatorReward.decode(message.value);
  },
  toProto(message: MsgWithdrawDelegatorReward): Uint8Array {
    return MsgWithdrawDelegatorReward.encode(message).finish();
  },
  toProtoMsg(message: MsgWithdrawDelegatorReward): MsgWithdrawDelegatorRewardProtoMsg {
    return {
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
      value: MsgWithdrawDelegatorReward.encode(message).finish()
    };
  },
  registerTypeUrl() {}
};
function createBaseMsgWithdrawDelegatorRewardResponse(): MsgWithdrawDelegatorRewardResponse {
  return {
    amount: []
  };
}
/**
 * MsgWithdrawDelegatorRewardResponse defines the Msg/WithdrawDelegatorReward
 * response type.
 * @name MsgWithdrawDelegatorRewardResponse
 * @package cosmos.distribution.v1beta1
 * @see proto type: cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse
 */
export const MsgWithdrawDelegatorRewardResponse = {
  typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse",
  aminoType: "cosmos-sdk/MsgWithdrawDelegatorRewardResponse",
  is(o: any): o is MsgWithdrawDelegatorRewardResponse {
    return o && (o.$typeUrl === MsgWithdrawDelegatorRewardResponse.typeUrl || Array.isArray(o.amount) && (!o.amount.length || Coin.is(o.amount[0])));
  },
  isSDK(o: any): o is MsgWithdrawDelegatorRewardResponseSDKType {
    return o && (o.$typeUrl === MsgWithdrawDelegatorRewardResponse.typeUrl || Array.isArray(o.amount) && (!o.amount.length || Coin.isSDK(o.amount[0])));
  },
  isAmino(o: any): o is MsgWithdrawDelegatorRewardResponseAmino {
    return o && (o.$typeUrl === MsgWithdrawDelegatorRewardResponse.typeUrl || Array.isArray(o.amount) && (!o.amount.length || Coin.isAmino(o.amount[0])));
  },
  encode(message: MsgWithdrawDelegatorRewardResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    for (const v of message.amount) {
      Coin.encode(v!, writer.uint32(10).fork()).ldelim();
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgWithdrawDelegatorRewardResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgWithdrawDelegatorRewardResponse();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.amount.push(Coin.decode(reader, reader.uint32()));
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgWithdrawDelegatorRewardResponse>): MsgWithdrawDelegatorRewardResponse {
    const message = createBaseMsgWithdrawDelegatorRewardResponse();
    message.amount = object.amount?.map(e => Coin.fromPartial(e)) || [];
    return message;
  },
  fromAmino(object: MsgWithdrawDelegatorRewardResponseAmino): MsgWithdrawDelegatorRewardResponse {
    const message = createBaseMsgWithdrawDelegatorRewardResponse();
    message.amount = object.amount?.map(e => Coin.fromAmino(e)) || [];
    return message;
  },
  toAmino(message: MsgWithdrawDelegatorRewardResponse): MsgWithdrawDelegatorRewardResponseAmino {
    const obj: any = {};
    if (message.amount) {
      obj.amount = message.amount.map(e => e ? Coin.toAmino(e) : undefined);
    } else {
      obj.amount = message.amount;
    }
    return obj;
  },
  fromAminoMsg(object: MsgWithdrawDelegatorRewardResponseAminoMsg): MsgWithdrawDelegatorRewardResponse {
    return MsgWithdrawDelegatorRewardResponse.fromAmino(object.value);
  },
  toAminoMsg(message: MsgWithdrawDelegatorRewardResponse): MsgWithdrawDelegatorRewardResponseAminoMsg {
    return {
      type: "cosmos-sdk/MsgWithdrawDelegatorRewardResponse",
      value: MsgWithdrawDelegatorRewardResponse.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgWithdrawDelegatorRewardResponseProtoMsg): MsgWithdrawDelegatorRewardResponse {
    return MsgWithdrawDelegatorRewardResponse.decode(message.value);
  },
  toProto(message: MsgWithdrawDelegatorRewardResponse): Uint8Array {
    return MsgWithdrawDelegatorRewardResponse.encode(message).finish();
  },
  toProtoMsg(message: MsgWithdrawDelegatorRewardResponse): MsgWithdrawDelegatorRewardResponseProtoMsg {
    return {
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorRewardResponse",
      value: MsgWithdrawDelegatorRewardResponse.encode(message).finish()
    };
  },
  registerTypeUrl() {
    if (!GlobalDecoderRegistry.registerExistingTypeUrl(MsgWithdrawDelegatorRewardResponse.typeUrl)) {
      return;
    }
    Coin.registerTypeUrl();
  }
};
