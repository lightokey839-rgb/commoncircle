/// <reference types="vite/client" />

// qrcode 1.5.4 ships no types; only the call the app uses is declared.
declare module 'qrcode' {
  const QRCode: {
    toString(text: string, options: { type: 'svg'; margin?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; color?: { dark?: string; light?: string } }): Promise<string>
  }
  export default QRCode
}
