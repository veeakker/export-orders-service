/**
  * Joins multiple arrays together by taking their cross product, joining all properties.
 * @param {Array} records Array of objects to be joined.
 * @param {Array<Array>} others Other arrays of objects to be joined.
 * @result {Array} Each combinedresult
 */
export default function joinResults(records, ...others) {
  if( others.length == 0 ) {
    return records; // arg is an array and contains the sole results
  } else {
    let results = [];
    for( let flattenedNestedRecord of joinResults( ...others ) )
      for( let record of records )
        results.push( Object.assign( {}, record, flattenedNestedRecord ) )
    return results;
  }
}

