export const DEFAULT_VOLUNTEER_SKILL_OPTIONS = [
  'organization',
  'communication',
  'food handling',
  'logistics',
  'measurement',
  'healthcare',
  'photography',
  'documentation',
  'cleanup',
  'inventory management',
  'customer service',
  'preparation',
  'teaching',
  'facilitation',
  'data entry',
  'attention to detail',
  'computer skills',
  'storytelling',
  'technical skills',
  'coordination',
  'leadership',
  'equipment management',
  'guidance',
  'note-taking',
] as const;

export const TASK_SKILL_OPTIONS = [
  'Communication',
  'Teamwork',
  'Documentation',
  'Data Entry',
  'First Aid',
  'Event Logistics',
  'Facilitation',
  'Crowd Management',
  'Child Engagement',
] as const;

export function mergeSkillOptions(...groups: Array<readonly string[]>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const skill of group) {
      const normalizedSkill = skill.trim();
      if (!normalizedSkill) {
        continue;
      }

      const skillKey = normalizedSkill.toLowerCase();
      if (seen.has(skillKey)) {
        continue;
      }

      seen.add(skillKey);
      merged.push(normalizedSkill);
    }
  }

  return merged;
}