// Created by NMKato Solutions
// Local macOS 12+ German dictation. Microphone never leaves the device.
// Requires native Speech framework and explicit OS permissions.
import Foundation
import Speech
import AVFoundation

func send(_ value:String, success:Bool) {
    let object:[String:Any] = ["ok":success,"text":value]
    if let bytes = try? JSONSerialization.data(withJSONObject:object) {
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    }
}
func pump(_ deadline:Date, until check:()->Bool) {
    while Date()<deadline && !check() {
        _ = RunLoop.current.run(mode:.default,before:Date(timeIntervalSinceNow:0.08))
    }
}
guard let recognizer=SFSpeechRecognizer(locale:Locale(identifier:"de-DE")),
      recognizer.supportsOnDeviceRecognition else {
    send("Offline-Spracherkennung für Deutsch nicht installiert.",success:false)
    exit(1)
}
var speechPermission:SFSpeechRecognizerAuthorizationStatus = .notDetermined
SFSpeechRecognizer.requestAuthorization { value in
    DispatchQueue.main.async { speechPermission=value }
}
pump(Date(timeIntervalSinceNow:15),until:{speechPermission != .notDetermined})
guard speechPermission == .authorized else {
    send("Berechtigung für Spracherkennung fehlt.",success:false)
    exit(2)
}
var micGranted:Bool? = nil
let current=AVCaptureDevice.authorizationStatus(for:.audio)
if current == .authorized {
    micGranted = true
} else if current == .notDetermined {
    AVCaptureDevice.requestAccess(for:.audio){granted in
        DispatchQueue.main.async {micGranted=granted}
    }
} else {
    micGranted=false
}
pump(Date(timeIntervalSinceNow:15),until:{micGranted != nil})
guard micGranted == true else {
    send("Mikrofonberechtigung fehlt.",success:false)
    exit(3)
}
let request=SFSpeechAudioBufferRecognitionRequest()
request.requiresOnDeviceRecognition=true
request.shouldReportPartialResults=true
request.taskHint = .dictation
let engine=AVAudioEngine()
let input=engine.inputNode
let format=input.outputFormat(forBus:0)
var text=""
var completed=false
var failed=false
let task=recognizer.recognitionTask(with:request){result,error in
    DispatchQueue.main.async {
        if let result=result {
            text=result.bestTranscription.formattedString
            if result.isFinal {completed=true}
        }
        if error != nil {failed=true}
    }
}
input.installTap(onBus:0,bufferSize:1024,format:format){buffer,_ in
    request.append(buffer)
}
do {
    engine.prepare()
    try engine.start()
} catch {
    input.removeTap(onBus:0)
    task.cancel()
    send("Mikrofonaufnahme konnte nicht gestartet werden.",success:false)
    exit(4)
}
pump(Date(timeIntervalSinceNow:12),until:{completed||failed})
engine.stop()
input.removeTap(onBus:0)
request.endAudio()
pump(Date(timeIntervalSinceNow:2),until:{completed||failed})
task.cancel()
let transcript=text.trimmingCharacters(in:.whitespacesAndNewlines)
guard !transcript.isEmpty && !failed else {
    send("Keine erkennbare lokale Transkription.",success:false)
    exit(5)
}
send(String(transcript.prefix(1200)),success:true)
