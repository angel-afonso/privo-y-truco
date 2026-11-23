import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cantoAudioPath, cantos, cantoTakes, cantoVoiceId } from "../src/ui/cantos";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error("Falta ELEVENLABS_API_KEY en .env.");

const delivery = {
  mesa: { direction: "brisk, one breath, falling intonation", speed: 1.2, seed: 31 },
  firme: { direction: "quick and decisive, tight rhythm, firm downward inflection", speed: 1.2, seed: 83 },
  directa: { direction: "short and direct, fast connected speech, falling intonation", speed: 1.2, seed: 157 },
};
const requested = process.argv.slice(2);
if (requested.some(id => !Object.hasOwn(cantos, id))) throw new Error("Canto desconocido.");
const directory = fileURLToPath(new URL(`../public/${cantoAudioPath}/`, import.meta.url));
await mkdir(directory, { recursive: true });

for (const name of cantoTakes) {
  const take = delivery[name];
  for (const [id, text] of Object.entries(cantos)) {
    if (requested.length && !requested.includes(id)) continue;
    const filename = id + "." + name + ".mp3";
    const path = directory + filename;
    if (await Bun.file(path).exists()) continue;

    // Dos afirmaciones cuando se encadena un lance: «A ley. Envido.»
    const spoken = text.slice(1, -1).replace(/^A ley, (\p{L})/u, (_, letter: string) => "A ley. " + letter.toUpperCase()) + ".";
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${cantoVoiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        redirect: "error",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: `[${take.direction}] ${spoken}`,
          language_code: "es",
          model_id: "eleven_v3",
          seed: take.seed,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.85,
            speed: take.speed,
          },
        }),
      },
    );
    if (!response.ok) {
      const { detail } = await response.json().catch(() => ({}));
      throw new Error(`ElevenLabs: ${filename} · HTTP ${response.status} · ${detail?.message ?? detail?.status ?? "error"}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.headers.get("content-type")?.startsWith("audio/") || bytes.length < 500) {
      throw new Error(`Audio incompleto para ${filename}.`);
    }
    const temp = path + "." + process.pid + ".tmp";
    await writeFile(temp, bytes);
    await rename(temp, path);
    console.log(filename);
  }
}
