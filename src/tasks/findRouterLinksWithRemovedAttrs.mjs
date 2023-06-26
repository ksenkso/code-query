import { allVueFiles, attrKey, logSet, zipMap } from '../utils.mjs';
import { matchAny, matchComponentWithProp, parseVueFile } from '../selection.mjs';

export const findRouterLinksWithRemovedAttrs = async () => {
  const removedProps = ['append', 'event', 'tag', 'exact'];
  const sets = zipMap(removedProps, () => new Set());

  for await (const { content, loc, name } of allVueFiles()) {
    const program = parseVueFile(content);
    try {
      matchComponentWithProp({
        program,
        source: content,
        matchComponent: 'routerlink',
        matchProp: (name) => removedProps.includes(name),
        matchValue: matchAny,
        visit(node, attr) {
          sets[attrKey(attr)].add(loc(attr.loc));
        }
      });
    } catch (err) {
      console.log(`Error in file: ${name}`);
      throw err;
    }

  }

  Object.entries(sets).forEach(([key, set]) => {
    console.log(`Prop: ${key}`);
    logSet(set);
  });
};
