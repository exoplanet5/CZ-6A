import {calculateVisibility} from './visibility.js';
self.onmessage = ({data:{mission,T0}}) => {
  try {
    const result = calculateVisibility(mission,T0);
    self.postMessage(result,[result.mel.buffer,result.darkAtInsertion.buffer]);
  } catch (error) { self.postMessage({error:error.message}); }
};
