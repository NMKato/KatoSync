// Created by NMKato Solutions
// KatoSync on-device macOS de-DE dictation. Structured stdout events, STOP over stdin.
// No audio file, no network fallback. A bound native .app Info.plist owns TCC permissions.
import Foundation
import Speech
import AVFoundation

func emit(_ kind:String,_ code:String = "",_ text:String = "") {
    let data:[String:String] = ["kind":kind,"code":code,"text":text]
    if let out = try? JSONSerialization.data(withJSONObject:data) {
        FileHandle.standardOutput.write(out)
        FileHandle.standardOutput.write(Data([10]))
    }
}
func pump(_ deadline:Date, until check:()->Bool) {
    while Date()<deadline && !check() {
        _ = RunLoop.current.run(mode:.default,before:Date(timeIntervalSinceNow:0.07))
    }
}
func fail(_ code:String,_ exitCode:Int32) -> Never {
    emit("error",code)
    exit(exitCode)
}

guard let recognizer=SFSpeechRecognizer(locale:Locale(identifier:"de-DE")),
      recognizer.supportsOnDeviceRecognition else {
    fail("ondevice_unavailable",1)
}
let speechStatus=SFSpeechRecognizer.authorizationStatus()
let micStatus=AVCaptureDevice.authorizationStatus(for:.audio)
if CommandLine.arguments.contains("--preflight") {
    if speechStatus == .denied || speechStatus == .restricted { fail("speech_denied",2) }
    if micStatus == .denied || micStatus == .restricted { fail("mic_denied",3) }
    emit("status", speechStatus == .authorized && micStatus == .authorized ? "ready" : "needs_permission")
    exit(0)
}
emit("permission")
var speechPermission:SFSpeechRecognizerAuthorizationStatus=speechStatus
if speechStatus == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async { speechPermission=status }
    }
    pump(Date(timeIntervalSinceNow:15),until:{speechPermission != .notDetermined})
}
guard speechPermission == .authorized else {
    fail(speechPermission == .notDetermined ? "permission_timeout" : "speech_denied",4)
}
var micGranted:Bool?=micStatus == .authorized ? true :
  (micStatus == .notDetermined ? nil : false)
if micGranted == nil {
    AVCaptureDevice.requestAccess(for:.audio) { granted in
        DispatchQueue.main.async { micGranted=granted }
    }
    pump(Date(timeIntervalSinceNow:15),until:{micGranted != nil})
}
guard micGranted == true else {
    fail(micGranted == nil ? "permission_timeout" : "mic_denied",5)
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
var lastPartial=""
var stopRequested=false
DispatchQueue.global(qos:.userInitiated).async {
    while let command=readLine() {
        if command.trimmingCharacters(in:.whitespacesAndNewlines) == "STOP" {
            DispatchQueue.main.async { stopRequested=true }
            break
        }
    }
}
let task=recognizer.recognitionTask(with:request){result,error in
    DispatchQueue.main.async {
        if let result=result {
            let recognized=result.bestTranscription.formattedString
            if !recognized.isEmpty {
                text=recognized
                if recognized != lastPartial && !result.isFinal {
                    lastPartial=recognized
                    emit("partial","",String(recognized.suffix(280)))
                }
            }
            if result.isFinal {completed=true}
        }
        if error != nil && !completed { failed=true }
    }
}
input.installTap(onBus:0,bufferSize:1024,format:format){buffer,_ in request.append(buffer)}
do {
    engine.prepare()
    try engine.start()
} catch {
    input.removeTap(onBus:0)
    task.cancel()
    fail("audio_engine",6)
}
emit("recording")
pump(Date(timeIntervalSinceNow:12),until:{stopRequested || completed || failed})
engine.stop()
input.removeTap(onBus:0)
request.endAudio()
emit("processing")
// Allow the offline recognizer to deliver a final utterance after manual STOP.
task.finish()
pump(Date(timeIntervalSinceNow:6),until:{completed || failed})
let transcript=text.trimmingCharacters(in:.whitespacesAndNewlines)
task.cancel()
if transcript.isEmpty && failed { fail("recognizer_error",8) }
guard !transcript.isEmpty else { fail("no_speech",7) }
emit("complete","",String(transcript.prefix(1200)))
