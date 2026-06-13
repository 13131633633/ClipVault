import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.clipvault.app',
  appName: 'ClipVault',
  webDir: 'dist',
  backgroundColor: '#FFFFFF',
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#FFFFFF',
    },
  },
};

export default config;
