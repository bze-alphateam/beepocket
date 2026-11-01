// Copied from @bze/bzejs 3.2.0 (src/cosmos/gov/v1/tx.ts), registry lines removed. Do not edit; re-copy on chain upgrades.
//@ts-nocheck
import { VoteOption, voteOptionFromJSON, voteOptionToJSON } from "./gov";
import { BinaryReader, BinaryWriter } from "../../../binary";
import { isSet } from "../../../helpers";
/**
 * MsgVote defines a message to cast a vote.
 * @name MsgVote
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVote
 */
export interface MsgVote {
  /**
   * proposal_id defines the unique id of the proposal.
   */
  proposalId: bigint;
  /**
   * voter is the voter address for the proposal.
   */
  voter: string;
  /**
   * option defines the vote option.
   */
  option: VoteOption;
  /**
   * metadata is any arbitrary metadata attached to the Vote.
   */
  metadata: string;
}
export interface MsgVoteProtoMsg {
  typeUrl: "/cosmos.gov.v1.MsgVote";
  value: Uint8Array;
}
/**
 * MsgVote defines a message to cast a vote.
 * @name MsgVoteAmino
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVote
 */
export interface MsgVoteAmino {
  /**
   * proposal_id defines the unique id of the proposal.
   */
  proposal_id: string;
  /**
   * voter is the voter address for the proposal.
   */
  voter?: string;
  /**
   * option defines the vote option.
   */
  option?: VoteOption;
  /**
   * metadata is any arbitrary metadata attached to the Vote.
   */
  metadata?: string;
}
export interface MsgVoteAminoMsg {
  type: "cosmos-sdk/v1/MsgVote";
  value: MsgVoteAmino;
}
/**
 * MsgVote defines a message to cast a vote.
 * @name MsgVoteSDKType
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVote
 */
export interface MsgVoteSDKType {
  proposal_id: bigint;
  voter: string;
  option: VoteOption;
  metadata: string;
}
/**
 * MsgVoteResponse defines the Msg/Vote response type.
 * @name MsgVoteResponse
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVoteResponse
 */
export interface MsgVoteResponse {}
export interface MsgVoteResponseProtoMsg {
  typeUrl: "/cosmos.gov.v1.MsgVoteResponse";
  value: Uint8Array;
}
/**
 * MsgVoteResponse defines the Msg/Vote response type.
 * @name MsgVoteResponseAmino
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVoteResponse
 */
export interface MsgVoteResponseAmino {}
export interface MsgVoteResponseAminoMsg {
  type: "cosmos-sdk/v1/MsgVoteResponse";
  value: MsgVoteResponseAmino;
}
/**
 * MsgVoteResponse defines the Msg/Vote response type.
 * @name MsgVoteResponseSDKType
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVoteResponse
 */
export interface MsgVoteResponseSDKType {}
function createBaseMsgVote(): MsgVote {
  return {
    proposalId: BigInt(0),
    voter: "",
    option: 0,
    metadata: ""
  };
}
/**
 * MsgVote defines a message to cast a vote.
 * @name MsgVote
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVote
 */
export const MsgVote = {
  typeUrl: "/cosmos.gov.v1.MsgVote",
  aminoType: "cosmos-sdk/v1/MsgVote",
  is(o: any): o is MsgVote {
    return o && (o.$typeUrl === MsgVote.typeUrl || typeof o.proposalId === "bigint" && typeof o.voter === "string" && isSet(o.option) && typeof o.metadata === "string");
  },
  isSDK(o: any): o is MsgVoteSDKType {
    return o && (o.$typeUrl === MsgVote.typeUrl || typeof o.proposal_id === "bigint" && typeof o.voter === "string" && isSet(o.option) && typeof o.metadata === "string");
  },
  isAmino(o: any): o is MsgVoteAmino {
    return o && (o.$typeUrl === MsgVote.typeUrl || typeof o.proposal_id === "bigint" && typeof o.voter === "string" && isSet(o.option) && typeof o.metadata === "string");
  },
  encode(message: MsgVote, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.proposalId !== BigInt(0)) {
      writer.uint32(8).uint64(message.proposalId);
    }
    if (message.voter !== "") {
      writer.uint32(18).string(message.voter);
    }
    if (message.option !== 0) {
      writer.uint32(24).int32(message.option);
    }
    if (message.metadata !== "") {
      writer.uint32(34).string(message.metadata);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgVote {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgVote();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.proposalId = reader.uint64();
          break;
        case 2:
          message.voter = reader.string();
          break;
        case 3:
          message.option = reader.int32() as any;
          break;
        case 4:
          message.metadata = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgVote>): MsgVote {
    const message = createBaseMsgVote();
    message.proposalId = object.proposalId !== undefined && object.proposalId !== null ? BigInt(object.proposalId.toString()) : BigInt(0);
    message.voter = object.voter ?? "";
    message.option = object.option ?? 0;
    message.metadata = object.metadata ?? "";
    return message;
  },
  fromAmino(object: MsgVoteAmino): MsgVote {
    const message = createBaseMsgVote();
    if (object.proposal_id !== undefined && object.proposal_id !== null) {
      message.proposalId = BigInt(object.proposal_id);
    }
    if (object.voter !== undefined && object.voter !== null) {
      message.voter = object.voter;
    }
    if (object.option !== undefined && object.option !== null) {
      message.option = object.option;
    }
    if (object.metadata !== undefined && object.metadata !== null) {
      message.metadata = object.metadata;
    }
    return message;
  },
  toAmino(message: MsgVote): MsgVoteAmino {
    const obj: any = {};
    obj.proposal_id = message.proposalId ? message.proposalId?.toString() : "0";
    obj.voter = message.voter === "" ? undefined : message.voter;
    obj.option = message.option === 0 ? undefined : message.option;
    obj.metadata = message.metadata === "" ? undefined : message.metadata;
    return obj;
  },
  fromAminoMsg(object: MsgVoteAminoMsg): MsgVote {
    return MsgVote.fromAmino(object.value);
  },
  toAminoMsg(message: MsgVote): MsgVoteAminoMsg {
    return {
      type: "cosmos-sdk/v1/MsgVote",
      value: MsgVote.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgVoteProtoMsg): MsgVote {
    return MsgVote.decode(message.value);
  },
  toProto(message: MsgVote): Uint8Array {
    return MsgVote.encode(message).finish();
  },
  toProtoMsg(message: MsgVote): MsgVoteProtoMsg {
    return {
      typeUrl: "/cosmos.gov.v1.MsgVote",
      value: MsgVote.encode(message).finish()
    };
  },
  registerTypeUrl() {}
};
function createBaseMsgVoteResponse(): MsgVoteResponse {
  return {};
}
/**
 * MsgVoteResponse defines the Msg/Vote response type.
 * @name MsgVoteResponse
 * @package cosmos.gov.v1
 * @see proto type: cosmos.gov.v1.MsgVoteResponse
 */
export const MsgVoteResponse = {
  typeUrl: "/cosmos.gov.v1.MsgVoteResponse",
  aminoType: "cosmos-sdk/v1/MsgVoteResponse",
  is(o: any): o is MsgVoteResponse {
    return o && o.$typeUrl === MsgVoteResponse.typeUrl;
  },
  isSDK(o: any): o is MsgVoteResponseSDKType {
    return o && o.$typeUrl === MsgVoteResponse.typeUrl;
  },
  isAmino(o: any): o is MsgVoteResponseAmino {
    return o && o.$typeUrl === MsgVoteResponse.typeUrl;
  },
  encode(_: MsgVoteResponse, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgVoteResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseMsgVoteResponse();
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
  fromPartial(_: Partial<MsgVoteResponse>): MsgVoteResponse {
    const message = createBaseMsgVoteResponse();
    return message;
  },
  fromAmino(_: MsgVoteResponseAmino): MsgVoteResponse {
    const message = createBaseMsgVoteResponse();
    return message;
  },
  toAmino(_: MsgVoteResponse): MsgVoteResponseAmino {
    const obj: any = {};
    return obj;
  },
  fromAminoMsg(object: MsgVoteResponseAminoMsg): MsgVoteResponse {
    return MsgVoteResponse.fromAmino(object.value);
  },
  toAminoMsg(message: MsgVoteResponse): MsgVoteResponseAminoMsg {
    return {
      type: "cosmos-sdk/v1/MsgVoteResponse",
      value: MsgVoteResponse.toAmino(message)
    };
  },
  fromProtoMsg(message: MsgVoteResponseProtoMsg): MsgVoteResponse {
    return MsgVoteResponse.decode(message.value);
  },
  toProto(message: MsgVoteResponse): Uint8Array {
    return MsgVoteResponse.encode(message).finish();
  },
  toProtoMsg(message: MsgVoteResponse): MsgVoteResponseProtoMsg {
    return {
      typeUrl: "/cosmos.gov.v1.MsgVoteResponse",
      value: MsgVoteResponse.encode(message).finish()
    };
  },
  registerTypeUrl() {}
};
