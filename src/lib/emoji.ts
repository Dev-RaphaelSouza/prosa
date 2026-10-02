// Um conjunto enxuto de emojis por categoria. São os do sistema: nada de imagem pra baixar.

const split = (s: string) => s.split(' ');

export const EMOJI: { name: string; icon: string; list: string[] }[] = [
  {
    name: 'Carinhas',
    icon: '😀',
    list: split(
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖',
    ),
  },
  {
    name: 'Gestos',
    icon: '👋',
    list: split('👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💅 💪 🦾 🧠 👀 👁️ 👅 👄 🫶 🫡 🫠 🫣 🤷 🤦 🙋 🙅 🙆 💁'),
  },
  {
    name: 'Corações',
    icon: '❤️',
    list: split('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✨ ⭐ 🌟 💫 🔥 💥 💯 💢 💤 💦 🎉 🎊 🎈 🎁 🏆 🥇 👑 💎 🔔 ✅ ❌ ❓ ❗ ⚠️ 🚫 ♻️ 🆗 🆒 🆕'),
  },
  {
    name: 'Bichos e natureza',
    icon: '🐶',
    list: split('🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🦇 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦀 🐬 🐳 🦈 🐊 🦜 🌵 🌲 🌴 🌱 🍀 🌸 🌹 🌻 🌙 ☀️ ⛅ 🌧️ ⚡ ❄️ 🌈 🌊'),
  },
  {
    name: 'Comida',
    icon: '🍕',
    list: split('🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🌽 🥕 🥔 🍞 🥐 🧀 🥚 🥓 🥩 🍗 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🍝 🍜 🍣 🍱 🍚 🍤 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍿 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🍹'),
  },
  {
    name: 'Atividades',
    icon: '🎮',
    list: split('⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🥊 🏋️ 🚴 🏄 🎮 🕹️ 🎲 ♟️ 🧩 🎯 🎳 🎬 🎤 🎧 🎵 🎶 🎸 🎹 🥁 🎨 📷 📚 ✏️ 💻 ⌨️ 🖥️ 📱 💡 🔧 🔨 🚀 ✈️ 🚗 🚲 🏠 🏖️ ⏰ 💰 💸 📌 📎 🔒 🔑 🗑️'),
  },
];

/** As reações rápidas que aparecem ao passar o mouse numa mensagem. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥'];

const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u;

/** Mensagem só de emojis (até 6) aparece grande. */
export function isJumbo(text: string): boolean {
  return text.length <= 40 && ONLY_EMOJI.test(text) && !/^[\d\s#*]+$/.test(text) && [...new Intl.Segmenter().segment(text.replace(/\s/g, ''))].length <= 6;
}
