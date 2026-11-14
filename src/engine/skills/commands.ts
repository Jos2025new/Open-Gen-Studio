import { z } from 'zod';
import { defineCommand } from '../commands/types';
import { setComposer } from '../../store/store';
import { SKILLS, skillById } from './catalog';
import { WORKFLOWS, workflowById, describeWorkflow } from './workflows';
import { guideIndex, readGuide } from './guides';

const none = z.object({}).strict();

export const commands = [
  defineCommand({
    id: 'skills.skill.list',
    title: 'List skills',
    description: 'Lists skill ids, names and descriptions.',
    args: none,
    effect: 'read',
    run: () => SKILLS.map(({ id, name, description }) => ({ id, name, description })),
  }),
  defineCommand({
    id: 'skills.skill.get',
    title: 'Get skill',
    description: 'Returns the requested skill.',
    args: z.object({ skill: z.string() }).strict(),
    effect: 'read',
    available: (_ctx, args) => args?.skill === undefined || skillById(args.skill) ? true : `No skill "${args.skill}".`,
    run: (_ctx, args) => skillById(args.skill),
  }),
  defineCommand({
    id: 'skills.skill.select',
    title: 'Select skill',
    description: 'Sets or clears the composer skill.',
    args: z.object({ skill: z.string().nullable() }).strict(),
    effect: 'write',
    available: (_ctx, args) => args?.skill == null || skillById(args.skill) ? true : `No skill "${args.skill}".`,
    debt: 'Changes the composer skill on screen.',
    run: (_ctx, args) => setComposer({ skillId: args.skill }),
  }),
  defineCommand({
    id: 'skills.workflow.list',
    title: 'List workflows',
    description: 'Lists workflow ids, names and descriptions.',
    args: none,
    effect: 'read',
    run: () => WORKFLOWS.map(({ id, name, description }) => ({ id, name, description })),
  }),
  defineCommand({
    id: 'skills.workflow.get',
    title: 'Get workflow',
    description: 'Describes the requested workflow.',
    args: z.object({ workflow: z.string() }).strict(),
    effect: 'read',
    available: (_ctx, args) => args?.workflow === undefined || workflowById(args.workflow) ? true : `No workflow "${args.workflow}".`,
    run: (_ctx, args) => describeWorkflow(workflowById(args.workflow)!),
  }),
  defineCommand({
    id: 'skills.workflow.select',
    title: 'Select workflow',
    description: 'Sets or clears the composer workflow.',
    args: z.object({ workflow: z.string().nullable() }).strict(),
    effect: 'write',
    available: (_ctx, args) => args?.workflow == null || workflowById(args.workflow) ? true : `No workflow "${args.workflow}".`,
    debt: 'Changes the composer workflow on screen.',
    run: (_ctx, args) => setComposer({ workflowId: args.workflow }),
  }),
  defineCommand({
    id: 'skills.guide.list',
    title: 'List guides',
    description: 'Returns the guide index.',
    args: none,
    effect: 'read',
    run: () => guideIndex(),
  }),
  defineCommand({
    id: 'skills.guide.read',
    title: 'Read guide',
    description: 'Returns the requested guide text.',
    args: z.object({ guide: z.string() }).strict(),
    effect: 'read',
    available: (_ctx, args) => args?.guide === undefined || readGuide(args.guide) !== undefined ? true : `No guide "${args.guide}".`,
    run: (_ctx, args) => readGuide(args.guide),
  }),
];

export const SKILLS_ACTIONS: Record<string, string> = {
  skillById: 'skills.skill.get',
  activeSkill: '- Helper resolving a skill from selections.',
  workflowById: '- Lookup helper used by other functions.',
  describeWorkflow: 'skills.workflow.get',
  workflowMakesVideo: '- Helper classifying workflow steps.',
  workflowMakesImage: '- Helper classifying workflow steps.',
  guideIndex: 'skills.guide.list',
  guideWorkspaceProblem: '- Helper checking workspace compatibility.',
  readGuide: 'skills.guide.read',
  refreshLoadedGuides: '- Helper transforms conversation history.',
  workflowCard: '- Returns an intermediate guide card.',
  cardInsteadOfGuide: '- Chooses an intermediate guide card.',
};
