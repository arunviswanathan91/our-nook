import Capacitor
import CoreHaptics
import UIKit

/// Foreground-only tactile feedback. Incoming partner signals use the same
/// authenticated channel as the web app; this bridge only plays local patterns.
@objc(NookHapticsPlugin)
public final class NookHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NookHapticsPlugin"
    public let jsName = "NookHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var engine: CHHapticEngine?
    private var player: CHHapticPatternPlayer?

    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(pauseHaptics),
            name: UIApplication.willResignActiveNotification, object: nil)
        // Capacitor 8.5 uses scenes. Stop at scene deactivation as well as the
        // app notification so switching apps / locking never leaves a pulse.
        NotificationCenter.default.addObserver(self, selector: #selector(pauseHaptics),
            name: UIScene.willDeactivateNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc public func capabilities(_ call: CAPPluginCall) {
        call.resolve(["supported": CHHapticEngine.capabilitiesForHardware().supportsHaptics])
    }

    @objc public func play(_ call: CAPPluginCall) {
        guard let timing = call.getArray("pattern", Int.self),
              !timing.isEmpty, timing.count <= 31, timing.count % 2 == 1,
              timing.allSatisfy({ (0...1000).contains($0) }),
              timing.reduce(0, +) <= 5000,
              timing.enumerated().contains(where: { $0.offset % 2 == 0 && $0.element > 0 }) else {
            call.reject("Choose a short, valid haptic pattern.")
            return
        }
        let intensity = call.getDouble("intensity") ?? 0.4
        let sharpness = call.getDouble("sharpness") ?? 0.5
        guard intensity.isFinite, sharpness.isFinite,
              (0...1).contains(intensity), (0...1).contains(sharpness) else {
            call.reject("Haptic strength must be between zero and one.")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  UIApplication.shared.applicationState == .active,
                  CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
                call.resolve(["played": false])
                return
            }
            do {
                let engine = try self.readyEngine()
                try self.player?.stop(atTime: CHHapticTimeImmediate)
                var events: [CHHapticEvent] = []
                var time: TimeInterval = 0
                for (index, milliseconds) in timing.enumerated() {
                    let duration = Double(milliseconds) / 1000
                    if index % 2 == 0 && duration > 0 {
                        let parameters = [
                            CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(intensity)),
                            CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(sharpness))
                        ]
                        events.append(CHHapticEvent(eventType: .hapticContinuous,
                            parameters: parameters, relativeTime: time, duration: duration))
                    }
                    time += duration
                }
                let pattern = try CHHapticPattern(events: events, parameters: [])
                let next = try engine.makePlayer(with: pattern)
                self.player = next
                try next.start(atTime: CHHapticTimeImmediate)
                // Accepted by Core Haptics; this is not a physical delivery
                // receipt and must not be shown to the sender as one.
                call.resolve(["played": true])
            } catch {
                self.cancelPlayback()
                self.engine = nil
                call.reject("This phone could not play the vibration. Please try again.")
            }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.cancelPlayback()
            call.resolve()
        }
    }

    @objc private func pauseHaptics() {
        DispatchQueue.main.async { [weak self] in self?.cancelPlayback() }
    }

    private func cancelPlayback() {
        try? player?.stop(atTime: CHHapticTimeImmediate)
        player = nil
    }

    private func readyEngine() throws -> CHHapticEngine {
        if engine == nil {
            let next = try CHHapticEngine()
            next.playsHapticsOnly = true
            next.isAutoShutdownEnabled = true
            next.resetHandler = { [weak self, weak next] in
                DispatchQueue.main.async {
                    guard let self = self, self.engine === next else { return }
                    self.player = nil
                    self.engine = nil
                }
            }
            next.stoppedHandler = { [weak self, weak next] _ in
                DispatchQueue.main.async {
                    guard let self = self, self.engine === next else { return }
                    self.player = nil
                }
            }
            engine = next
        }
        let ready = engine!
        try ready.start()
        return ready
    }
}
