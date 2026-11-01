package club.partycasino.app;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.util.Arrays;

/**
 * Host Card Emulation: il telefono si presenta come un tag NFC Forum Type 4 (sola lettura)
 * che contiene un messaggio NDEF con un URL (tavolo o pass giocatore).
 *
 * Qualsiasi lettore NDEF lo legge come un normale tag: un altro Android (reader mode) o un
 * iPhone con Core NFC (NFCNDEFReaderSession). È attivo solo mentre l'app ha impostato un URL
 * tramite NfcHcePlugin.start(); altrimenti risponde "file non trovato" e viene ignorato.
 *
 * Flusso APDU (NFC Forum Type 4 Tag Operation 2.0):
 *   SELECT AID D2760000850101 → SELECT CC (E103) → READ BINARY → SELECT NDEF (E104) → READ BINARY
 */
public class NdefHceService extends HostApduService {

    private static final byte[] NDEF_AID = {(byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01};
    private static final byte[] CC_FILE_ID = {(byte) 0xE1, 0x03};
    private static final byte[] NDEF_FILE_ID = {(byte) 0xE1, 0x04};

    private static final byte[] SW_OK = {(byte) 0x90, 0x00};
    private static final byte[] SW_NOT_FOUND = {0x6A, (byte) 0x82};
    private static final byte[] SW_WRONG_P1P2 = {0x6B, 0x00};
    private static final byte[] SW_INS_NOT_SUPPORTED = {0x6D, 0x00};

    /** NLEN (2 byte, big endian) + messaggio NDEF. null = emulazione spenta. */
    private static volatile byte[] ndefFile = null;

    private enum Selected { NONE, APP, CC, NDEF }

    private Selected selected = Selected.NONE;

    public static void setUrl(String url) {
        if (url == null) {
            ndefFile = null;
            return;
        }
        byte[] msg = new NdefMessage(NdefRecord.createUri(url)).toByteArray();
        byte[] file = new byte[msg.length + 2];
        file[0] = (byte) ((msg.length >> 8) & 0xFF);
        file[1] = (byte) (msg.length & 0xFF);
        System.arraycopy(msg, 0, file, 2, msg.length);
        ndefFile = file;
    }

    public static boolean isActive() {
        return ndefFile != null;
    }

    private static byte[] capabilityContainer(int maxNdefSize) {
        return new byte[] {
            0x00, 0x0F,                 // CCLEN: 15 byte
            0x20,                       // mapping version 2.0
            0x00, 0x3B,                 // MLe: max 59 byte per R-APDU
            0x00, 0x34,                 // MLc: max 52 byte per C-APDU
            0x04, 0x06,                 // NDEF File Control TLV (T, L)
            (byte) 0xE1, 0x04,          // ID del file NDEF
            (byte) ((maxNdefSize >> 8) & 0xFF), (byte) (maxNdefSize & 0xFF),
            0x00,                       // lettura libera
            (byte) 0xFF                 // scrittura non consentita
        };
    }

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        byte[] file = ndefFile;
        if (file == null || apdu == null || apdu.length < 4) return SW_NOT_FOUND;

        int ins = apdu[1] & 0xFF;
        int p1 = apdu[2] & 0xFF;
        int p2 = apdu[3] & 0xFF;

        if (ins == 0xA4) { // SELECT
            if (p1 == 0x04 && apdu.length >= 5) { // selezione per AID
                int lc = apdu[4] & 0xFF;
                if (apdu.length >= 5 + lc && lc == NDEF_AID.length
                        && Arrays.equals(Arrays.copyOfRange(apdu, 5, 5 + lc), NDEF_AID)) {
                    selected = Selected.APP;
                    return SW_OK;
                }
                selected = Selected.NONE;
                return SW_NOT_FOUND;
            }
            if (p1 == 0x00 && apdu.length >= 7 && selected != Selected.NONE) { // selezione per file ID
                byte[] fid = Arrays.copyOfRange(apdu, 5, 7);
                if (Arrays.equals(fid, CC_FILE_ID)) {
                    selected = Selected.CC;
                    return SW_OK;
                }
                if (Arrays.equals(fid, NDEF_FILE_ID)) {
                    selected = Selected.NDEF;
                    return SW_OK;
                }
            }
            return SW_NOT_FOUND;
        }

        if (ins == 0xB0) { // READ BINARY
            byte[] data;
            if (selected == Selected.CC) data = capabilityContainer(Math.max(file.length, 0xFF));
            else if (selected == Selected.NDEF) data = file;
            else return SW_NOT_FOUND;

            int offset = (p1 << 8) | p2;
            int le = apdu.length >= 5 ? (apdu[4] & 0xFF) : 0;
            if (le == 0) le = 256;
            if (offset > data.length) return SW_WRONG_P1P2;
            int end = Math.min(data.length, offset + le);
            byte[] chunk = Arrays.copyOfRange(data, offset, end);
            byte[] out = new byte[chunk.length + 2];
            System.arraycopy(chunk, 0, out, 0, chunk.length);
            out[chunk.length] = SW_OK[0];
            out[chunk.length + 1] = SW_OK[1];
            return out;
        }

        return SW_INS_NOT_SUPPORTED;
    }

    @Override
    public void onDeactivated(int reason) {
        selected = Selected.NONE;
    }
}
