// @ts-nocheck
import { DataSource, BIField, Field, OperatorType } from "./global";
import {
  getFieldsSummaryService,
  FieldSummary,
  getGroupFieldsService,
  combineFieldsService,
  generateDashBoard,
  ViewSpace,
  Subspace,
  clusterMeasures
} from "./service";
import { GlobalState, StateUpdater } from './state';



type Action<T> = (select: () => GlobalState, updateState: (updater:StateUpdater<GlobalState>) => void, params: T) => any;



const univariateSummary: Action<{dataSource: DataSource; fields: BIField[]}> = async (select, updateState, params) => {

  const { dataSource, fields } = params;
  const state = select();
  const dimensions = fields
    .filter(field => field.type === "dimension")
    .map(field => field.name);
  const measures = fields
    .filter(field => field.type === "measure")
    .map(field => field.name);
  // updateState(draft => { draft.loading.univariateSummary = true })
  try {
    /**
     * get summary of the orignal dataset(fields without grouped)
     */

    //计算所有字段的  Distribution(看上去是指一个字段的所有值的出现频次) 类型(nominal temporal等)  熵
    const originSummary = await getFieldsSummaryService(
      dataSource,
      fields.map(f => f.name),
      state.useServer
    );
    console.log(
      {
        "方法":"getFieldsSummaryService",
        "操作":`
          计算所有字段的  Distribution(看上去是指一个字段的所有值的出现频次) 类型(nominal temporal等)  熵
          核心函数:
          import { UnivariateSummary } from 'visual-insights';
          const { getAllFieldsDistribution, getAllFieldTypes, getAllFieldsEntropy } = UnivariateSummary;
        `,
        "输出":originSummary
      }
    )
    


    // todo only group dimension.
    let fieldWithTypeList: Field[] = originSummary
      ? originSummary
          .filter(f => dimensions.includes(f.fieldName))
          .map(f => {
            return {
              name: f.fieldName,
              type: f.type
            };
          })
      : [];
    /**
     * bug:
     * should not group measures!!!
     */
    //分组
    const groupedResult = await getGroupFieldsService(
      dataSource,
      fieldWithTypeList,
      state.useServer
    );
    console.log(
      {
        "方法":"getGroupFieldsService",
        "操作":`
          分组
          核心函数:
          import { UnivariateSummary } from 'visual-insights';
          UnivariateSummary.groupFields
        `,
        "输出":groupedResult
      }
    )
    const { groupedData, newFields } = groupedResult
      ? groupedResult
      : { groupedData: dataSource, newFields: fieldWithTypeList };
    /**
     * `newBIFields` shares the same length (size) with fields.
     * It repalces some of the fields with high entropy with a grouped new field.
     * newBIFields does not contain field before grouped.
     */
    const newBIFields: BIField[] = fields.map(field => {
      let groupedField = newFields.find(
        f => f.name === field.name + "(group)"
      );
      return {
        name: groupedField ? groupedField.name : field.name,
        type: field.type
      };
    });
    const newDimensions: string[] = newBIFields
      .filter(f => f.type === "dimension")
      .map(f => f.name);

    /**
     * groupedSummary only contains newFields generated during `groupFieldsService`.
     */
    //对新增分组字段计算 Distribution(看上去是指一个字段的所有值的出现频次)  类型(nominal temporal等) 熵
    const groupedSummary = await getFieldsSummaryService(
      groupedData,
      newFields,
      state.useServer
    );
    console.log(
      {
        "方法":"对分组新增字段执行getGroupFieldsService",
        "操作":`
          对新增分组字段计算 Distribution(看上去是指一个字段的所有值的出现频次)  类型(nominal temporal等) 熵
        `,
        "输出":groupedSummary
      }
    )

    
    updateState(draft => {
      draft.cookedDataSource = groupedData;
      draft.summary = {
        origin: originSummary || [],
        grouped: groupedSummary || []
      }
      draft.loading.univariateSummary = false;
    });
    // setFields(newBIFields);
    // tmp solutions
    let summary = (groupedSummary || []).concat(originSummary || []);
    return {
      groupedData,
      summary,
      newDimensions,
      measures
    }
    // await SubspaceSeach(groupedData, summary, newDimensions, measures, "sum");
  } catch (error) {
    console.error(error)
    updateState(draft => {
      draft.loading.univariateSummary = false;
    });
  }
}



interface SubspaceSeachParams {
  groupedData: DataSource;
  summary: FieldSummary[];
  dimensions: string[];
  measures: string[];
  operator: OperatorType
}
const  subspaceSearch: Action<SubspaceSeachParams> = async (select, updateState, params) => {
  const { groupedData: dataSource, summary, dimensions, measures, operator } = params;
  const state = select();
  updateState(draft => {
    draft.loading.subspaceSearching = true;
  });

  let orderedDimensions: Array<{ name: string; entropy: number }> = [];
  orderedDimensions = dimensions.map(d => {
    let target = summary.find(g => g.fieldName === d);
    return {
      name: d,
      entropy: target ? target.entropy : Infinity
    };
  });


  orderedDimensions.sort((a, b) => a.entropy - b.entropy);
  updateState(draft => {
    draft.cookedDimensions = orderedDimensions.map(d => d.name);
    draft.cookedMeasures = measures;
  });
  const selectedDimensions = orderedDimensions
    .map(d => d.name)
    .slice(
      0,
      Math.round(orderedDimensions.length * state.topK.dimensionSize)
    );
  try {
    // insightExtraction
    const subspaceList = await combineFieldsService(
      dataSource,
      selectedDimensions,
      measures,
      operator,
      state.useServer
    );
    if (subspaceList) {
      updateState(draft => {
        draft.subspaceList = subspaceList;
      });
    }
    updateState(draft => {
      draft.loading.subspaceSearching = false;
    });
  } catch (error) {
    updateState(draft => {
      draft.loading.subspaceSearching = false;
    });
  }
}

interface GetViewSpacesProps {
  subspaceList: Subspace[];
  maxGroupNumber: number;
  useServer: boolean;
}
const getViewSpaces: Action<GetViewSpacesProps> = async (select, updateState, params) => {
  const { subspaceList, maxGroupNumber, useServer } = params;
  let viewSpaces: ViewSpace[] = [];
  try {
    viewSpaces = await clusterMeasures(
      maxGroupNumber,
      subspaceList.map(space => {
        return {
          dimensions: space.dimensions,
          measures: space.measures,
          matrix: space.correlationMatrix
        };
      }),
      useServer
    )
    updateState(draft => {
      draft.viewSpaces = viewSpaces
    })
  } catch (error) {
    console.log(error)
  }
}

const extractInsights: Action<{dataSource: DataSource; fields: BIField[]}> = async (state, updateState, params) => {
  console.log({
    "方法":"extractInsights",
    "btn":"开始分析",
    "params":"原始数据+字段信息(维度,标量)",
    "rawParams":params,
    "操作":`
      univariateSummary
      subspaceSearch
    `
  })
  const { dataSource, fields } = params;
  updateState(draft => {
    draft.loading.gallery = true
  })
  try {

    const univariateResult = await univariateSummary(state, updateState, {
      dataSource, fields
    });
    console.log(
      {
        "方法":"univariateSummary",
        "操作":`
          1,计算所有字段的 Distribution(看上去是指一个字段的所有值的出现频次)  类型(nominal temporal等) 熵
          2,分组
          3,对分组后数据执行1
          4,更新全局状态
        `,
        "输出":univariateResult
      }
    )
      if (univariateResult) {
        const {
          groupedData,
          summary,
          newDimensions,
          measures
        } = univariateResult;
        await subspaceSearch(state, updateState, {
          groupedData, summary, dimensions: newDimensions, measures, operator: "sum"
        });
        console.log(
          {
            "方法":"subspaceSearch",
            "操作":`
              获得子空间列表
            `,
            "params":{
              groupedData, summary, dimensions: newDimensions, measures, operator: "sum"
            },
            "输出":"见combineFieldsService"          
          }
        )
        
      }
  } catch (error) {
  } finally {
    updateState(draft => {
      draft.loading.gallery = false
      draft.loading.gallery = false
    })
  }
}

const getDashBoard: Action<{dataSource: DataSource, dimensions: string[], measures: string[]}> = async (select, updateState, params) => {
  const state = select();
  const { dataSource, dimensions, measures } = params;
  updateState(draft => {
    draft.loading.dashBoard = true
  })
  try {
    const dashBoardList = await generateDashBoard(dataSource, dimensions, measures, state.subspaceList, state.useServer)
    updateState(draft => {
      draft.dashBoardList = dashBoardList;
    })
  } catch (error) {
    console.error(error)
  } finally {
    updateState(draft => {
      draft.loading.dashBoard = false
    })
  }
}
const actions = {
  univariateSummary,
  subspaceSearch,
  extractInsights,
  getDashBoard,
  getViewSpaces
}
export type Actions =  typeof actions

type valueof<T> = T[keyof T]

type Foo = Parameters<typeof subspaceSearch> // ReturnType
export type Test = valueof<{  [key in keyof Actions]: {
  name: key,
  params: Parameters<Actions[key]>[2]
}}>

export default actions;
