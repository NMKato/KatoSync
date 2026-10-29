// Created by NMKato Solutions
// MARK: Chat-Fehler ohne rohe Backend-Daten, Pfade oder Anmeldedetails darstellen.
export type LocalChatFailure =
  | {key:"continuity.chat.modelUnavailable";reload:false}
  | {key:"continuity.chat.historyChanged";reload:true}
  | {key:"continuity.chat.projectChanged";reload:true}
  | {key:"continuity.chat.saveError";reload:true};

/** Backend-Ausgaben niemals wörtlich anzeigen. Nur explizit bekannte Fehlerklassen. */
export function classifyLocalChatFailure(error:unknown):LocalChatFailure{
  const detail=typeof error==="string"?error:"";
  if(detail==="CHAT_MODEL_NOT_READY" || detail==="CHAT_IMAGE_MODEL_NOT_READY" ||
     detail.startsWith("Gemma lokal nicht bereit") ||
     detail.startsWith("Gemma konnte das Bild lokal nicht")){
    return {key:"continuity.chat.modelUnavailable",reload:false};
  }
  if(detail==="CHAT_STALE_HISTORY" ||
     detail.startsWith("Chat-Historie hat sich verändert") ||
     detail.startsWith("Chat-Fortschritt") ||
     detail.startsWith("Lokale Chatsitzung benötigt")){
    return {key:"continuity.chat.historyChanged",reload:true};
  }
  if(detail==="CHAT_PROJECT_CHANGED" ||
     detail.startsWith("Git-HEAD hat sich geändert") ||
     detail.startsWith("Git-HEAD veränderte") ||
     detail.startsWith("Memory-Fabric-Projektidentität") ||
     detail.startsWith("Projektordner stimmt nicht")){
    return {key:"continuity.chat.projectChanged",reload:true};
  }
  return {key:"continuity.chat.saveError",reload:true};
}
