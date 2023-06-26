import { allVueFiles, attrValue, uniqueLogger } from '../utils.mjs';
import { matchAny, matchComponentWithProp, parseVueFile } from '../selection.mjs';

export const findTeleportsWithTargetInsideApp = async () => {
  const log = uniqueLogger();
  for await (const { content } of allVueFiles()) {
    const program = parseVueFile(content);
    matchComponentWithProp({
      program,
      source: content,
      matchComponent: 'teleport',
      matchProp: 'to',
      matchValue: matchAny,
      visit(node, attr) {
        log(attrValue(attr, content));
      }
    });
  }
};
