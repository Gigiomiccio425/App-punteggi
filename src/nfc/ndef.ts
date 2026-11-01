// Codifica/decodifica minima di record NDEF (formato del plugin @capgo/capacitor-nfc).

export interface RawNdefRecord {
  tnf: number;
  type: number[];
  id: number[];
  payload: number[];
}

// Prefissi abbreviati dell'NFC Forum URI RTD
const URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:', 'ftp://anonymous:anonymous@',
  'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:',
  'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://',
  'irdaobex://', 'file://', 'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

const TNF_WELL_KNOWN = 0x01;
const TNF_ABSOLUTE_URI = 0x03;
const RTD_URI = 0x55; // 'U'
const RTD_TEXT = 0x54; // 'T'

export function encodeUriRecord(url: string): RawNdefRecord {
  let prefixIndex = 0;
  for (let i = 1; i < URI_PREFIXES.length; i++) {
    if (url.startsWith(URI_PREFIXES[i]) && URI_PREFIXES[i].length > URI_PREFIXES[prefixIndex].length) prefixIndex = i;
  }
  const rest = new TextEncoder().encode(url.slice(URI_PREFIXES[prefixIndex].length));
  return { tnf: TNF_WELL_KNOWN, type: [RTD_URI], id: [], payload: [prefixIndex, ...rest] };
}

export function decodeRecord(r: RawNdefRecord): string | null {
  const bytes = Uint8Array.from(r.payload);
  if (r.tnf === TNF_WELL_KNOWN && r.type.length === 1 && r.type[0] === RTD_URI) {
    return (URI_PREFIXES[bytes[0]] ?? '') + new TextDecoder().decode(bytes.slice(1));
  }
  if (r.tnf === TNF_WELL_KNOWN && r.type.length === 1 && r.type[0] === RTD_TEXT) {
    const status = bytes[0];
    const langLen = status & 0x3f;
    const utf16 = (status & 0x80) !== 0;
    return new TextDecoder(utf16 ? 'utf-16' : 'utf-8').decode(bytes.slice(1 + langLen));
  }
  if (r.tnf === TNF_ABSOLUTE_URI) return new TextDecoder().decode(Uint8Array.from(r.type));
  return null;
}

export function firstText(records: RawNdefRecord[] | null | undefined): string | null {
  for (const r of records ?? []) {
    const t = decodeRecord(r);
    if (t) return t;
  }
  return null;
}
