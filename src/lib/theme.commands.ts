import { z } from 'zod';
import { defineCommand } from '../engine/commands/types';
import { ACCENT_CHOICES, BASE_CHOICES, readTheme, setAccent, setBase } from './theme';

/* The appearance as commands (ADR 0030): the Ctrl+K palette finds them by "theme", "tema", "color" or "accent". Each one
 * wraps the same setter the Appearance settings call, so both always agree. */
export const commands = [
  defineCommand({
    id: 'appearance.theme.set',
    title: 'Set base theme',
    description: 'The base theme of the app (sistema follows the system light or dark setting).',
    aliases: ['appearance.tema.base', 'appearance.theme.base', 'appearance.dark.light'],
    args: z.object({ base: z.enum(BASE_CHOICES) }).strict(),
    effect: 'write',
    run: (_ctx, args) => {
      setBase(args.base);
      return { base: readTheme().base };
    },
  }),
  defineCommand({
    id: 'appearance.accent.set',
    title: 'Set accent colour',
    description: 'The highlight colour of the app.',
    aliases: ['appearance.theme.accent', 'appearance.tema.acento', 'appearance.color.set'],
    args: z.object({ accent: z.enum(ACCENT_CHOICES) }).strict(),
    effect: 'write',
    run: (_ctx, args) => {
      setAccent(args.accent);
      return { accent: readTheme().accent };
    },
  }),
];
