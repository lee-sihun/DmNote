import { attachPluginDomInteractions } from './pluginDomInteractions';

export const attachPluginDialogInteractions = (root: HTMLElement) =>
  attachPluginDomInteractions(root, { requireCheckboxKnob: true });
