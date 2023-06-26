import { allVueFiles, iterateFiles, normalizeComponentName, uniqueLogger } from '../utils.mjs';
import { matchAny, matchComponentWithProp, parseVueFile } from '../selection.mjs';

export const findComponentsWithClickNative = () => {
  const logUniq = uniqueLogger();
  return iterateFiles(allVueFiles(), (file) => {
    const program = parseVueFile(file.content);
    matchComponentWithProp({
      program,
      source: file.content,
      matchComponent: matchAny,
      matchProp: (name, attr) => {
        return attr.key.type === 'VDirectiveKey' && attr.key.modifiers && attr.key.modifiers.some(mod => mod.name && mod.name === 'native');
      },
      matchValue: matchAny,
      visit(node) {
        logUniq(normalizeComponentName(node.parent.name));
      }
    });
  });
};
