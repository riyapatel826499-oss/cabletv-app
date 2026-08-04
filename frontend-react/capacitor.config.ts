import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ssncables.wasool',
  appName: 'Wasool',
  webDir: '../backend/static',
  android: {
    allowMixedContent: false,
  },
};

export default config;
