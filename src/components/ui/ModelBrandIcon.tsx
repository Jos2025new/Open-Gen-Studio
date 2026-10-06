// Who makes a model, read from its id or name: the maker's logo (LobeHub icons, MIT; see NOTICE), else a monogram.
const logos = import.meta.glob('../../assets/brands/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const logo = (name: string) => logos[`../../assets/brands/${name}.svg`];
const VENDORS: Array<[RegExp, string, string]> = [
  [/z-ai|zai-org|zhipu|\bglm\b/, 'zai', 'Z.ai'],
  [/gpt|openai|dall-?e|sora|whisper/, 'openai', 'OpenAI'],
  [/nano-?banana|gemini/, 'gemini-color', 'Google Gemini'],
  [/imagen|veo|google/, 'google-color', 'Google'],
  [/seedream|seedance|seed3d|seedvr|bytedance|omnihuman|dreamina/, 'bytedance-color', 'ByteDance'],
  [/flux|black-?forest|bfl/, 'bfl', 'Black Forest Labs'],
  [/recraft/, 'recraft', 'Recraft'],
  [/ideogram/, 'ideogram', 'Ideogram'],
  [/kling/, 'kling-color', 'Kling'],
  [/qwen/, 'qwen-color', 'Qwen'],
  [/\bwan\b|wan-?\d|wan2|alibaba|z-?image|tongyi/, 'alibaba-color', 'Alibaba'],
  [/hailuo/, 'hailuo-color', 'Hailuo'],
  [/minimax/, 'minimax-color', 'MiniMax'],
  [/grok|xai/, 'xai', 'xAI'],
  [/hunyuan|tencent/, 'hunyuan-color', 'Hunyuan'],
  [/runway|gen-?4/, 'runway', 'Runway'],
  [/luma|ray-?2|photon/, 'luma-color', 'Luma'],
  [/pixverse/, 'pixverse-color', 'PixVerse'],
  [/meshy/, 'meshy-color', 'Meshy'],
  [/tripo/, 'tripo-color', 'Tripo'],
  [/elevenlabs/, 'elevenlabs', 'ElevenLabs'],
  [/stable-?diffusion|stability|sdxl|sd3/, 'stability-color', 'Stability AI'],
  [/vidu/, 'vidu-color', 'Vidu'],
];

export function vendorOf(m: { id: string; name: string }) {
  const text = `${m.id} ${m.name}`.toLowerCase();
  return VENDORS.find(([re]) => re.test(text));
}

export function ModelBrandIcon({ id, name, local = false, className = 'ml-mono' }: { id: string; name: string; local?: boolean; className?: string }) {
  const hit = vendorOf({ id, name });
  const src = hit ? logo(hit[1]) : undefined;
  return <span className={className} title={hit?.[2]} aria-hidden="true">
    {src ? <img src={src} alt="" draggable={false} /> : local ? '⌂' : name.trim().charAt(0).toUpperCase()}
  </span>;
}
