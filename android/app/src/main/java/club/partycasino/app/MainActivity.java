package club.partycasino.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // plugin locale per l'emulazione NFC (telefono → tag), vedi NfcHcePlugin
        registerPlugin(NfcHcePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
