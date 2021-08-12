// CONSTANTS
// Important: convert every number to string before sending request
const APP_NAME = "FacebookCT";
const encodedCol = {
  'POST_URL':1,
  'COMMENT':2,
  'DELAY':3,
  'STATUS':4
};
const colorEnum = {
  "WARNING": '#FFA500',
  "ERROR":'#f00',
  "OK":'#0f0',
  'INFO':'#fff'
}
var DEFAULT_DELAY = 60;  // (sec) const in each batch, yet can be modified otherwise

// METHODS

function onOpen(){
  createMenu()
}
function createMenu(){
  var ui = SpreadsheetApp.getUi();
    ui.createMenu(APP_NAME)
    .addItem('Run Selection', 'work')
    .addItem('Set default delay', 'setDefaultDelay')
    .addToUi();
}
function getSheet(){
  return SpreadsheetApp.getActiveSheet();
}
function resetPreviousWork(i,j){
  let colStatus = getSheet().getRange(i,encodedCol.STATUS,j-i+1,1);
  // colStatus.setValue(statusEnum.COMMENTING);
  colStatus.setBackground("#fff");  // sets background color to white
  colStatus.setValue(""); // simply clears content
  colStatus.setNote(""); // simply clears notes
}
function isValidPostUrl(url){
  let pattern = /https:\/\/(www.)?facebook.com\/groups\/.+\/posts\/\d+\/?$/;
  return typeof(url)=='string' && url.match(pattern)!=null;
}
/**
 * Invalidates data in a data row
 * input: array of 5 strings with expected order as in encodedCol but all indicies -1
 * output: boolean indicating any entry is invalid
 */
function isValid(row){
  return  row.length==encodedCol.DELAY && 
          isValidPostUrl(row[encodedCol.POST_URL-1]) &&
          row[encodedCol.COMMENT-1].trim()!='' && 
          row[encodedCol.DELAY-1]>=0
}
/**
 * Pass parameters to HTML template and render to client as dialog
 */
function showWork(args){
  let template = HtmlService.createTemplateFromFile('dialog');
  template.args = JSON.stringify(args);
  let ui = template.evaluate();
  SpreadsheetApp.getUi().showSidebar(ui);
  // SpreadsheetApp.getUi().showModalDialog(ui,'Tasks list');
}
/**
 * Replaces all escaped '\n' to the new line feed properly.
 * Returns the new working string.
 */
function expand(text){
  return text.replace('\\n','\n');  
}
/**
 * Entry method to call from UI.
 */
function work(){
  var sheet = getSheet();
  let range = sheet.getActiveRange();
  let i = range.getRow();
  let j = range.getLastRow();
  console.log(`Executing rows from [${i},${j}]`);
  resetPreviousWork(i,j);   // resets previous work on the selection
  urlsList = [], paramsList = [], delaysList = [];
  while(i<=j){  // for each selected row
    let row = sheet.getRange(i,encodedCol.POST_URL,1,encodedCol.DELAY).getValues()[0];  // gets data row
    console.log(i,row);
    if(!isValid(row)){
      console.log('Row contains invalid data');
      setStatusValue(i,'Row contains invalid data',colorEnum.ERROR);
      ++i;
      continue;
    }
    // fill defaults
    if(row[encodedCol.DELAY-1]==''){
      getSheet().getDataRange().getCell(i,encodedCol.DELAY).setValue(DEFAULT_DELAY);
      row[encodedCol.DELAY-1] = DEFAULT_DELAY;
    }
    // sets up parameters
    let params = {
      'comment': expand(row[encodedCol.COMMENT-1]),
      'row':i
    };  
    urlsList.push(row[encodedCol.POST_URL-1]);
    paramsList.push(params);
    delaysList.push(row[encodedCol.DELAY-1]);
    ++i;  // next row
  }
  console.log(urlsList, paramsList, delaysList);
  showWork([urlsList, paramsList, delaysList]);
}

function isCellNotEmpty(row,col){
  return SpreadsheetApp.getActiveSheet().getRange(row,col).getValue()!='';
}
/**
 * Checks if attempt to comment has finished
 */
function isResultReady(row){
  return isCellNotEmpty(row,encodedCol.STATUS);
}
function setStatusValue(row,val,c=colorEnum.INFO){
  getSheet().getRange(row,encodedCol.STATUS).setValue(val).setBackground(c);
}
function getStatusValue(row){
  return getSheet().getRange(row,encodedCol.STATUS).getValue();
}
function setNote(row,col,msg,c=colorEnum.INFO){
  getSheet().getRange(row,col).setNote(msg).setBackground(c);
}

/**
 * Shortcut to put the (key,value) pair to document properties object.
 * params: key, value: string
 */
function setProperty(key, value){
  DOCUMENT_PROPERTIES.setProperty(key,value);
}
function getProperty(key){
  return DOCUMENT_PROPERTIES.getProperty(key);
}
function removeProperty(key){
  DOCUMENT_PROPERTIES.deleteProperty(key);
}
/**
 * Sets a trigger to send mail notifying user to click the link so our extension can delete the comment with such url.
 * Params: url: the comment url
 *         timeout: timeout to trigger (ms)
 *         row: the row expecting the result
 */
function scheduleDeleteComment(url, timeout, row){
  console.log('Received params: ',[url,timeout,row]);
  setStatusValue(row,url);  // sets cell value to url
  setNote(row,encodedCol.STATUS,statusEnum.PENDING_DELETE,colorEnum.WARNING); // sets warning note at cell
  let trigger = ScriptApp.newTrigger('sendDeleteCommentEmail').timeBased().after(timeout).create();   // setups and starts the trigger
  let triggerId = String(trigger.getUniqueId());  // gets unique id of this trigger
  let params = {url,row};
  setProperty(triggerId,JSON.stringify(params)); // assigns the params to this trigger id
}

/**
 * Shortcut to put params together and send via MailApp API
 * Params: to: recipient email. String.
 *         deleteUrl: configured URL to delete the comment.
 *         url: original comment URL for previewing before deletion.
 */
function sendMail(to, deleteUrl, url){
  let subject = `[FacebookCT] You scheduled to delete this comment`;
  let bodyTemplate = HtmlService.createTemplateFromFile('mail');
  bodyTemplate.url = url;
  bodyTemplate.deleteUrl = deleteUrl;
  let htmlBody = bodyTemplate.evaluate().getContent();
  MailApp.sendEmail({to,subject,htmlBody});
}
/**
 * Creates a configured URL for extension to recognizes and delete the comment
 * Params: url: the comment URL
 */
function generateDeleteUrl(url,row){
  return url+`&row=${row}&facebookct=true`;
}
/**
 * Shortcut to get the email address of the person running the script.
 */
function getCurrentUserEmail(){
  return Session.getActiveUser().getEmail();
}
function sendDeleteCommentEmail(ev){
  let triggerId = String(ev.triggerUid);  // gets the trigger ID of this trigger
  let {url,row} = JSON.parse(getProperty(triggerId)); //gets the params assigned to this trigger's ID
  let deleteUrl = generateDeleteUrl(url,row); // creates the delete url
  let to = getProperty(keyEnum.EMAIL);  // retrieves email address from document property
  to = to?to:getCurrentUserEmail(); // uses current user email if recipient not specified
  sendMail(to,deleteUrl,url);   // sends the email with those urls
  
}
function deleteProjectTriggers(){
  let triggersArray = ScriptApp.getProjectTriggers();
  for(let trigger of triggersArray){
    ScriptApp.deleteTrigger(trigger);
  }
}
function setDefaultDelay(){
  try{
    let cell = getSheet().getActiveCell();  // gets the active cell
    let delay = Integer.parseInt(cell.getValue());  // gets delay value from sheet
    DEFAULT_DELAY = delay;
    setNote(cell.getRow(),cell.getColumn(),`Default delay duration is set to ${delay} seconds.`,colorEnum.OK);
  } catch(e){
    setNote(cell.getRow(),cell.getColumn(),'Expected an positive integer for delay duration (seconds).',colorEnum.ERROR);
  }

}


































// PLAYGROUND & TESTS

function isValidPostUrlTest(){
  let cases = [ "https://google.com", 
                "https://facebook.com", 
                "https://www.facebook.com", 
                "https://www.facebook.com/groups/469290529874466/", 
                "https://www.facebook.com/groups/469290529874466/", 
                "https://facebook.com/groups/469290529874466/", 
                "https://www.facebook.com/groups/469290529874466/posts/2401782836625216/", 
                "https://facebook.com/groups/469290529874466/posts/2401782836625216/",
                "https://www.facebook.com/groups/469290529874466/posts/2401782836625216",
                "https://www.facebook.com/groups/351122206629977/posts/351122343296630?comment_id=351147113294153", 
                "https://www.facebook.com/groups/469290529874466/posts/2401782836625216/?comment_id=2405207342949432&__cft__[0]=AZUojZtGLmP9rZeJ9jgAfysbM9NK_qlYYTaQNneKiiAhDox4djuZtVEbWZH19TFgcLw3iZnrtseA0WcocgBgrzoeiNe-AK5dm-h2ui3VO_4Q4KPBwS1q75RI3PHQRzD5V2c27AieCb4ayzTGh2sVz-Xy&__tn__=R]-R"];
  let expected = [false,
                  false,
                  false,
                  false,
                  false,
                  false,
                  true,
                  true,
                  true,
                  false,
                  false]
  console.log('value | expectation | truth')
  for(let i = 0; i<cases.length; ++i){
    console.log(cases[i],expected[i],isValidPostUrl(cases[i]))
  }
}
function timeSubtractTest(){
  let now = new Date('2021/07/28 21:40');
  let cases = [ new Date('2021/07/28 22:40'),
                new Date('2021/07/28 21:41'),
                new Date('2021/07/29 21:40')]
  let expected = [1*60*60*1000,1*60*1000,24*60*60*1000]
  console.log('value | expectation | truth')
  for(let i = 0; i<cases.length; ++i){
    console.log(cases[i],expected[i],timeSubtract(cases[i],now))
  }
}
function demo(){
  // let row = [ 'https://www.facebook.com/groups/351122206629977/posts/351122309963300/',
  // 'Some people have been inbox-ing me about the vacancy recently, but sadly it has been filled.|I will let you know if it is opened again. Peace!',
  // true,
  // // new Date('Sat Aug 07 2021 05:00:00 GMT+0700 (Indochina Time)')];
  // ''];
  // console.log(row,isValid(row))
  // setNote(10,3,'hi')
  let content = getSheet().getActiveCell().getValue();
  console.log(content);
  console.log(content.replace('\\n','\n'))
}