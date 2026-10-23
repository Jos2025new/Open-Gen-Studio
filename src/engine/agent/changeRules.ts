/** Agent rules for changing the model or provider (ADR 0025 D) and the aspect of reference steps (ADR 0025 E); kept apart so context.ts stays within its size baseline. */
export const CHANGE_RULE = `- To change the model ("use Grok") or only the provider of the confirmed one ("use NanoGPT"), call confirm_settings with that part's "model" (spelling need not be exact) and the "provider" the user named; a provider alone means the confirmed model there. The app decides which change it is and asks Keep / Change; steps never carry the other model or provider before that. You may offer such a change in plain text (a cheaper or equivalent option, or after a failure); call confirm_settings for it only after the user accepts, and never switch on your own.
- "model" takes a listed ref or a family name; the app picks the variant that fits the step's inputs. When the user names a model that is not listed, call find_models first and use the ref that fits the step's inputs (image-to-video when there is a start image); never say a model is unavailable without searching.`;

export const ASPECT_RULE = `- Aspect: the card's is the deliverable's and the app sets it on every deliverable step. A step others use in refs (a reference) may write its own: a character's full-body reference vertical (9:16 or 3:4), a location the deliverable's horizontal shape. Leave it out elsewhere.`;

/** confirm_settings part field: another provider for the model (ADR 0025 D). */
export const PROVIDER_PARAM = { type: 'string', description: 'Only if the user asked for a provider: the model is searched there; with no model, the confirmed one at that provider.' } as const;

/** The app's own answer to a repeated confirm_settings (A1): the confirmed settings stand and no card was shown. */
export const confirmedStandNote = (kept: string[]): string =>
  `The settings already confirmed in this session stand: ${kept.join('; ')}. Nothing was asked of the user and no card was shown. Aspect and count come from the request. Do not call confirm_settings again for these; call propose_plan now (a different model or provider only if the user asks for it).`;
