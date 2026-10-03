import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.arunviswanathan91.ournook',
  appName: 'Our Nook',
  webDir: 'dist',
  backgroundColor: '#faf6f0',
  ios: { contentInset: 'never', backgroundColor: '#faf6f0' },
  // Bundle the verified app locally. Do not load remote executable app code.
}
export default config
