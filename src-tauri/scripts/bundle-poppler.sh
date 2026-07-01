#!/bin/bash
# Created by NMKato on 2026-07-01
# Buendelt poppler 'pdftotext' self-contained nach src-tauri/resources/poppler/ (Binary + alle
# Nicht-System-dylibs, auf @loader_path umgebogen), damit die App PDF->Text IMMER kann — ohne dass
# poppler auf dem Zielrechner installiert sein muss. Voraussetzung auf der BUILD-Maschine:
# `brew install poppler`. Ad-hoc-Signatur fuer Dev/`tauri dev`; der Release-Build signiert die
# Dateien danach mit Developer ID neu (siehe Release-Runbook). poppler = GPL: Quelle bereitstellen.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # src-tauri/
SYS_PDFTOTEXT="$(command -v pdftotext || echo /opt/homebrew/bin/pdftotext)"
[ -x "$SYS_PDFTOTEXT" ] || { echo "FEHLER: pdftotext nicht gefunden (brew install poppler)"; exit 1; }
HBREW_LIB="$(cd "$(dirname "$SYS_PDFTOTEXT")/../lib" && pwd)"

BIN="$HERE/resources/poppler/pdftotext"
LIBDIR="$HERE/resources/poppler/libs"
rm -rf "$HERE/resources/poppler"; mkdir -p "$LIBDIR"
cp "$SYS_PDFTOTEXT" "$BIN"; chmod u+w "$BIN"

collect() {
  local file="$1" dep name src
  while read -r dep; do
    case "$dep" in /usr/lib/*|/System/*|@loader_path/*|@executable_path/*|"") continue;; esac
    name=$(basename "$dep")
    src="$dep"; case "$dep" in @rpath/*) src="$HBREW_LIB/$name";; esac
    [ -f "$src" ] || src="$HBREW_LIB/$name"
    if [ ! -f "$LIBDIR/$name" ] && [ -f "$src" ]; then
      cp "$src" "$LIBDIR/$name"; chmod u+w "$LIBDIR/$name"
      collect "$LIBDIR/$name"
    fi
  done < <(otool -L "$file" 2>/dev/null | tail -n +2 | awk '{print $1}')
}
collect "$BIN"

# pdftotext-Abhaengigkeiten -> @loader_path/libs/<name>
while read -r dep; do
  case "$dep" in /usr/lib/*|/System/*|"") continue;; esac
  name=$(basename "$dep"); [ -f "$LIBDIR/$name" ] && install_name_tool -change "$dep" "@loader_path/libs/$name" "$BIN"
done < <(otool -L "$BIN" | tail -n +2 | awk '{print $1}')

# Jede lib: eigene id + interne Abhaengigkeiten -> @loader_path/<name>
for lib in "$LIBDIR"/*.dylib; do
  ln=$(basename "$lib"); install_name_tool -id "@loader_path/$ln" "$lib"
  while read -r dep; do
    case "$dep" in /usr/lib/*|/System/*|"") continue;; esac
    name=$(basename "$dep"); [ -f "$LIBDIR/$name" ] && install_name_tool -change "$dep" "@loader_path/$name" "$lib"
  done < <(otool -L "$lib" | tail -n +2 | awk '{print $1}')
done

# Ad-hoc signieren (install_name_tool invalidiert Signaturen -> sonst SIGKILL). Release re-signt mit Developer ID.
for lib in "$LIBDIR"/*.dylib; do codesign --force -s - "$lib" 2>/dev/null; done
codesign --force -s - "$BIN" 2>/dev/null

# Typst (self-contained Single-Binary -> PDF-Erzeugung) einfach kopieren + ad-hoc signieren.
SYS_TYPST="$(command -v typst || echo /opt/homebrew/bin/typst)"
rm -rf "$HERE/resources/typst"; mkdir -p "$HERE/resources/typst"
if [ -x "$SYS_TYPST" ]; then
  cp "$SYS_TYPST" "$HERE/resources/typst/typst"; chmod u+w "$HERE/resources/typst/typst"
  codesign --force -s - "$HERE/resources/typst/typst" 2>/dev/null
else
  echo "WARNUNG: typst nicht gefunden (brew install typst) -> PDF-Erzeugung faellt auf .typ zurueck"
fi
echo "poppler: $(ls "$LIBDIR" | wc -l | tr -d ' ') libs + pdftotext; typst: $([ -f "$HERE/resources/typst/typst" ] && echo ja || echo nein)"
