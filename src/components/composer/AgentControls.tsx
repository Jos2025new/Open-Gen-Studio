import { Check, ChevronDown, GitBranch, Sparkles, X } from 'lucide-react';
import { SKILLS, WORKFLOWS, skillById, workflowById } from '../../engine/skills';
import type { AgentStyle } from '../../engine/types';
import { setComposer, useStore } from '../../store/store';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Chip } from '../ui/primitives';

/** Agent modes: one dropdown, Auto by default. The tips say what each mode decides for the user. */
export const AGENT_MODES: Array<{ value: AgentStyle; label: string; tip: string }> = [
  { value: 'auto', label: 'Auto', tip: 'The agent decides; it asks one card only when something that changes the result is missing, and stops to confirm the cost' },
  { value: 'guided', label: 'Guided', tip: 'The agent asks a few questions (max rounds in Settings), then shows the plan' },
  { value: 'direct', label: 'Direct', tip: 'No questions and no settings card: the agent uses the models chosen in the composer; you approve the plan and its cost' },
];

function SkillsChip({ onPicked }: { onPicked?: () => void }) {
  const skillId = useStore((s) => s.composer.skillId);
  const pop = usePopover();
  const skill = skillById(skillId);
  return (
    <>
      <Chip ref={pop.ref} icon={Sparkles} active={pop.open || Boolean(skill)} onClick={pop.toggle} data-tip="Skills shape how the agent writes prompts">
        {skill ? skill.name : 'Skills'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={340} label="Skills" className="pop-scroll">
        <PopoverHeader title="Skills" sub="Expert know-how the agent applies to your request." />
        <div className="pick-list">
          {SKILLS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`pick-row ${s.id === skillId ? 'is-active' : ''}`}
              onClick={() => {
                setComposer({ skillId: s.id === skillId ? null : s.id });
                pop.close();
                onPicked?.();
              }}
            >
              <span className="pick-text">
                <span className="pick-name">{s.name}</span>
                <span className="pick-desc">{s.description}</span>
              </span>
              {s.id === skillId ? <Check size={14} className="pick-check" /> : null}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function WorkflowsChip({ onPicked }: { onPicked?: () => void }) {
  const workflowId = useStore((s) => s.composer.workflowId);
  const workspace = useStore((s) => s.ui.workspace);
  const pop = usePopover();
  const wf = workflowById(workflowId);
  const available = WORKFLOWS.filter((w) => w.workspaces.includes(workspace));
  const unavailable = WORKFLOWS.filter((w) => !w.workspaces.includes(workspace));
  return (
    <>
      <Chip ref={pop.ref} icon={GitBranch} active={pop.open || Boolean(wf)} onClick={pop.toggle} data-tip="Workflows give the agent a proven step structure">
        {wf ? wf.name : 'Workflows'}
      </Chip>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={360} label="Workflows" className="pop-scroll">
        <PopoverHeader title="Workflows" sub="Multi-step recipes. The agent adapts the prompts to your request." />
        <div className="pick-list">
          {available.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`pick-row ${w.id === workflowId ? 'is-active' : ''}`}
              onClick={() => {
                setComposer({ workflowId: w.id === workflowId ? null : w.id });
                pop.close();
                onPicked?.();
              }}
            >
              <span className="pick-text">
                <span className="pick-name">{w.name}</span>
                <span className="pick-desc">{w.description}</span>
                <span className="pick-steps">
                  {w.steps.map((s) => (
                    <span key={s.id} className={`step-dot k-${s.kind === 'op' ? 'tool' : s.kind}`} data-tip={s.title} />
                  ))}
                </span>
              </span>
              {w.id === workflowId ? <Check size={14} className="pick-check" /> : null}
            </button>
          ))}
          {unavailable.length ? <div className="menu-sep-label">Other workspaces</div> : null}
          {unavailable.map((w) => (
            <div key={w.id} className="pick-row is-disabled" data-tip={`Available in ${w.workspaces.join(', ')}`}>
              <span className="pick-text">
                <span className="pick-name">{w.name}</span>
                <span className="pick-desc">{w.description}</span>
              </span>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function AgentOptions({ activeOnly = false, onPicked }: { activeOnly?: boolean; onPicked?: () => void }) {
  const skillId = useStore((s) => s.composer.skillId);
  const workflowId = useStore((s) => s.composer.workflowId);
  return <>
    {!activeOnly || skillById(skillId) ? <SkillsChip onPicked={onPicked} /> : null}
    {!activeOnly || workflowById(workflowId) ? <WorkflowsChip onPicked={onPicked} /> : null}
  </>;
}

export function AgentMode() {
  const style = useStore((s) => s.composer.agentStyle);
  const pop = usePopover();
  const selected = AGENT_MODES.find((m) => m.value === style);
  return <>
    <button ref={pop.ref} type="button" className="ml-filter agent-mode" aria-label="Agent mode" aria-haspopup="dialog" aria-expanded={pop.open} title={selected?.tip} onClick={pop.toggle}>
      {selected?.label}<ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={170} label="Agent mode">
      <div className="menu" role="radiogroup" aria-label="Agent mode">
        {AGENT_MODES.map((m) => <button key={m.value} type="button" role="radio" aria-checked={m.value === style} className={`menu-item${m.value === style ? ' is-active' : ''}`} title={m.tip} onClick={() => { setComposer({ agentStyle: m.value }); pop.close(); }}>
          <span className="menu-text">{m.label}</span>{m.value === style ? <Check size={13} /> : null}
        </button>)}
      </div>
    </Popover>
  </>;
}

export function AgentControls({ showMode = true }: { showMode?: boolean }) {
  const workflowId = useStore((s) => s.composer.workflowId);
  const workspace = useStore((s) => s.ui.workspace);
  const wf = workflowById(workflowId);
  return (
    <>
      {showMode ? <AgentMode /> : null}
      <AgentOptions activeOnly />
      {wf && !wf.workspaces.includes(workspace) ? (
        <Chip icon={X} muted onClick={() => setComposer({ workflowId: null })} data-tip="This workflow does not apply here; it will be ignored">
          Not for {workspace}
        </Chip>
      ) : null}
    </>
  );
}
