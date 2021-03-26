import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Subspace } from '../../service';
import { DefaultButton, TeachingBubble, DirectionalHint } from 'office-ui-fabric-react';

import './index.css';
import { Field } from '../../global';
import { Specification } from '../../visBuilder/vegaBase';

interface StoryTellerProps {
  lang?: 'zh' | 'en';
  dimScores: Array<[string, number, number, Field]>;
  space: Subspace;
  spaceList: Subspace[];
  dimensions: string[];
  measures: string[];
  schema: Specification
}

const StoryTeller: React.FC<StoryTellerProps> = (props) => {
  const { space, dimensions = [], measures = [], dimScores = [], spaceList = [], schema } = props;
  const [isTeachingBubbleVisible, setIsTeachingBubbleVisible] = useState(false);
console.log(6767,dimScores)
  const sortedFieldsScores = useMemo<Array<[string, number, number, Field]>>(() => {
    // 排序依据：dimScores[1]->entropy, dimScores[2]->maxEntropy,
    return [...dimScores].sort((a, b) => a[1] - b[1]);
  }, [dimScores])

  // 从spaceList 取出 被当前选中space中dimList包含的 score最小的 space中的被包含的第一个dim 作为mostInfluencedDimension
  //TODO:score的计算逻辑 已知定位在combineFields中
  const mostInfluencedDimension = useMemo<string | undefined>(() => {
    if (typeof space === 'undefined') return;
    for (let sp of spaceList) {
      if (sp.dimensions.some(dim => {
        return space.dimensions.includes(dim)
      })) {
        return sp.dimensions.find(dim => {
          return space.dimensions.includes(dim)
        })
      }
    }
  }, [space, spaceList])
  // 选出currentSpace与dataView共有的measures中 value最小的作为bestMeasure
    //TODO:value的计算逻辑 已知定位在combineFields中
  const bestMeasure = useMemo<string | undefined>(() => {
    if (typeof space === 'undefined') return;
    const measuresInView = space.measures.filter(mea => measures.includes(mea.name));
    let min = Infinity;
    let minPos = 0;
    for (let i = 0; i < measuresInView.length; i++) {
      if (measuresInView[i].value < min) {
        min = measuresInView[i].value;
        minPos = i;
      }
    }
    return measuresInView[minPos].name;
  }, [measures, space])
// 选出当前dataView.dimensions中熵最小的作为countDiffField 
  const countDiffField = useMemo<string | undefined>(() => {
    let ans = sortedFieldsScores.find(dim => dimensions.includes(dim[0]));
    return ans ? ans[0] : undefined;
  }, [sortedFieldsScores, dimensions])
  const result = `
  ${ schema && schema.position ? `Current chart mainly focus on the relationship between ***${schema.position[0]}*** and ***${schema.position[1]}***` : ''}
  ${ dimensions.length > 1 ? `+ DataSource is grouped by ***${dimensions.join(', ')}***, measures(indicators) will propose strong difference of distribution between each other.` : '' }
  ${ measures.length > 1 ? `+ ***${measures.join(', ')}***are strongly related to each other` : '' }
  ${ countDiffField ? `+ The distribution of member countings of ***${countDiffField}*** seems to contain more orders and patterns.` : '' }
  ${ mostInfluencedDimension ? `+ ***${mostInfluencedDimension}*** has great influence on aggregated measure values.` : '' }
  ${ bestMeasure ? `+ ***${bestMeasure}*** is more likely to have patterns according to its distribution.` : '' }
  \`\`\
  `
  return (
    <div>
      <DefaultButton id="vis-summary" text="Summary" onClick={() => { setIsTeachingBubbleVisible(true) }} />
      {isTeachingBubbleVisible ? (
          <div>
            <TeachingBubble
              calloutProps={{ directionalHint: DirectionalHint.bottomCenter }}
              isWide={true}
              hasCloseIcon={true}
              closeButtonAriaLabel="Close"
              target={'#vis-summary'}
              onDismiss={() => { setIsTeachingBubbleVisible(false) }}
              headline="Chart Description"
            >
              <ReactMarkdown source={result} />
            </TeachingBubble>
          </div>
        ) : null}
    </div>
  )
}

export default StoryTeller