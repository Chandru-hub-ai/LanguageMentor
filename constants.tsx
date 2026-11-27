
import { LANGUAGE_PROFILES, getSystemInstruction } from './shared/profiles.ts';

export { LANGUAGE_PROFILES, getSystemInstruction };

export const POPULAR_TERMS = [
  "Cloud Computing",
  "Blockchain",
  "Generative AI",
  "Cybersecurity",
  "Data Science",
  "API",
  "Algorithm"
];

export const LEARNING_GEMS = [
  {
    id: 'tip1',
    title: 'Explain to a Kid',
    description: 'If you can\'t explain it to a 6-year-old, you don\'t understand it yourself.',
    icon: '👶',
    tag: 'Memory Hook'
  },
  {
    id: 'tip2',
    title: 'The 10-Minute Rule',
    description: 'Review what you learned 10 minutes after, then 1 day after, then 1 week after.',
    icon: '⏳',
    tag: 'Spaced Repetition'
  },
  {
    id: 'tip3',
    title: 'Visual Mapping',
    description: 'Draw a rough sketch of the concept. Your brain processes images 60k times faster than text.',
    icon: '🎨',
    tag: 'Deep Learning'
  },
  {
    id: 'tip4',
    title: 'Keyword Lacing',
    description: 'Find 3 keywords for any term and connect them into a single local analogy.',
    icon: '🔗',
    tag: 'Note Taking'
  }
];
