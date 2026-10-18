/**
 * Prompt reinforcement.
 *
 * Two problems showed up in the real renders: a prompt asking for "sitting at a
 * wooden desk" produced a corridor, and a rainy street gained a bystander nobody
 * asked for. Both are prompt-adherence failures, so the fix is to state the
 * constraints explicitly rather than hope the model infers them.
 *
 * Rules are applied at submit time and never written back into the stored prompt,
 * so turning one off restores exactly the text the user wrote.
 */

export type EnhanceRuleId =
  | 'soloSubject'
  | 'lockCamera'
  | 'lockLight'
  | 'noText';

export const ENHANCE_RULES: { id: EnhanceRuleId; text: string }[] = [
  { id: 'soloSubject', text: '画面中只有他一人，街道空无一人，不要出现路人' },
  { id: 'lockCamera', text: '机位与景别保持稳定，不做推拉摇移' },
  { id: 'lockLight', text: '光线方向与色温保持一致，不要改变打光' },
  { id: 'noText', text: '画面中不要出现任何文字、字幕或水印' },
];

export type PromptEnhancement = {
  enabled: boolean;
  rules: EnhanceRuleId[];
  /** 自由补充，追加在所有规则之后。 */
  extra: string;
};

export const createEmptyEnhancement = (): PromptEnhancement => ({
  enabled: false,
  rules: [],
  extra: '',
});

/** The suffixes that will actually be appended, in a stable order. */
export const activeRuleTexts = (enhancement: PromptEnhancement): string[] => {
  if (!enhancement.enabled) return [];
  const texts = ENHANCE_RULES.filter((rule) => enhancement.rules.includes(rule.id)).map(
    (rule) => rule.text
  );
  const extra = enhancement.extra.trim();
  if (extra) texts.push(extra);
  return texts;
};

/**
 * Append the active constraints to one shot.
 *
 * Kept separate from the stored prompt so the board always shows what the user
 * wrote, and the submitted text is reproducible from that plus the toggles.
 */
export const enhancePrompt = (prompt: string, enhancement: PromptEnhancement): string => {
  const texts = activeRuleTexts(enhancement);
  if (texts.length === 0) return prompt;
  const base = prompt.trim().replace(/[。.]$/, '');
  if (!base) return texts.join('。') + '。';
  return `${base}。${texts.join('。')}。`;
};
