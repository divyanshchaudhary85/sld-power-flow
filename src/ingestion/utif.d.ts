declare module "utif" {
  export interface IFD {
    width?: number;
    height?: number;
    data?: Uint8Array;
    [tag: string]: unknown;
  }
  export function decode(buffer: ArrayBuffer): IFD[];
  export function decodeImage(
    buffer: ArrayBuffer,
    ifd: IFD,
    ifds?: IFD[],
  ): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
  export function encodeImage(
    rgba: ArrayBuffer,
    width: number,
    height: number,
  ): ArrayBuffer;
  export function encode(ifds: IFD[]): ArrayBuffer;
  const UTIF: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
    encodeImage: typeof encodeImage;
    encode: typeof encode;
  };
  export default UTIF;
}
