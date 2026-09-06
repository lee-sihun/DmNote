export type BatchPickerTarget =
  | 'noteColor'
  | 'glowColor'
  | 'borderColor'
  | 'fill'
  | null;

export interface BatchLocalColors {
  fillIdle: string;
  fillActive: string;
}
