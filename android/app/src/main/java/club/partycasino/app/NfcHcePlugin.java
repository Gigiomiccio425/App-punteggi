package club.partycasino.app;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.nfc.NfcAdapter;
import android.nfc.cardemulation.CardEmulation;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin locale "NfcHce" (vedi src/nfc/nfc.ts): accende/spegne l'emulazione del tag NFC.
 * Mentre è attivo, il servizio NdefHceService è impostato come servizio preferito in primo piano,
 * così nessun'altra app registrata sullo stesso AID intercetta la lettura.
 */
@CapacitorPlugin(name = "NfcHce")
public class NfcHcePlugin extends Plugin {

    private String currentUrl = null;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        boolean hce = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION);
        JSObject result = new JSObject();
        result.put("available", adapter != null && hce);
        result.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("URL mancante");
            return;
        }
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (adapter == null) {
            call.reject("Questo telefono non ha l'NFC");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Attiva l'NFC nelle impostazioni del telefono");
            return;
        }
        currentUrl = url;
        NdefHceService.setUrl(url);
        setPreferred(adapter, true);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        currentUrl = null;
        NdefHceService.setUrl(null);
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (adapter != null) setPreferred(adapter, false);
        call.resolve();
    }

    private void setPreferred(NfcAdapter adapter, boolean on) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            try {
                CardEmulation ce = CardEmulation.getInstance(adapter);
                if (on) ce.setPreferredService(getActivity(), new ComponentName(getContext(), NdefHceService.class));
                else ce.unsetPreferredService(getActivity());
            } catch (Exception ignored) {
                // alcuni dispositivi non supportano il servizio preferito: l'emulazione funziona comunque
            }
        });
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // il servizio preferito decade quando l'app va in background: lo ripristiniamo al ritorno
        if (currentUrl == null) return;
        NdefHceService.setUrl(currentUrl);
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (adapter != null) setPreferred(adapter, true);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // per sicurezza l'emulazione resta attiva solo con l'app in primo piano
        NdefHceService.setUrl(null);
    }
}
