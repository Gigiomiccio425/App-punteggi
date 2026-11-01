import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'club.partycasino.app',
  appName: 'Party Casinò',
  webDir: 'dist',
  backgroundColor: '#05080a',
  android: {
    // Gli URL letti via NFC (https://<dominio>/j/... e /p/...) aprono l'app tramite App Links.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
