import Capacitor

final class NookViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NookHapticsPlugin())
    }
}
