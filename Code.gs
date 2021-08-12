// CONSTANTS
// Important: convert every number to string before sending request
const APP_NAME = "Facebook Post Commentor Tool";
const DOCUMENT_PROPERTIES = PropertiesService.getDocumentProperties();
const encodedCol = {
  'POST_URL':1,
  'COMMENT':2,
  'HAS_DELETE_COMMENT_TIMER':3,
  'TIMER_DATE_TIME':4,
  'STATUS':5
};
const statusEnum = {
  "COMMENTING":"Making comment",  // when the tool is waiting for resulting comment url from content script 
  "PENDING_DELETE":"Scheduled for deleting", // when comment url is valid but already scheduled to delete
  "DELETED":"Deleted"
}
const colorEnum = {
  "WARNING": '#FFA500',
  "ERROR":'#f00',
  "OK":'#0f0',
  'INFO':'#fff'
}
const keyEnum = {
  "EMAIL":"EMAIL"
}

// METHODS

function onOpen(){
  createMenu()
}
function createMenu(){
  var ui = SpreadsheetApp.getUi();
    ui.createMenu(APP_NAME)
    .addItem('Run Selection', 'work')
    .addItem('Delete all triggers', 'deleteProjectTriggers')
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
  return  row.length==encodedCol.TIMER_DATE_TIME && 
          isValidPostUrl(row[encodedCol.POST_URL-1]) &&
          row[encodedCol.COMMENT-1].trim()!='' &&
          (row[encodedCol.HAS_DELETE_COMMENT_TIMER-1]===false || (row[encodedCol.HAS_DELETE_COMMENT_TIMER-1] === true && typeof(row[encodedCol.TIMER_DATE_TIME-1].getUTCFullYear)==='function' && timeSubtract(row[encodedCol.TIMER_DATE_TIME-1],new Date())>=0))
}
/** 
 * Perform d1 sub d2 from year to month, to ... to minutes
 * input: d1, d2 of type Date
 * output: milliseconds from d1 to d2
 */
function timeSubtract(d1, d2){
  let utc1 = Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate(), d1.getUTCHours(), d1.getMinutes());
  let utc2 = Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate(), d2.getUTCHours(), d2.getMinutes());
  return utc1 - utc2;
}
/**
 * Pass parameters to HTML template and render to client as dialog
 */
function showWork(urlsList, paramsList){
  let template = HtmlService.createTemplateFromFile('dialog');
  template.args = JSON.stringify([urlsList, paramsList]);
  let ui = template.evaluate();
  SpreadsheetApp.getUi().showModalDialog(ui,'Tasks list');
}
function expand(text){
  return text.replaceAll('|','\n');
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
  urlsList = [], paramsList = [];
  while(i<=j){  // for each selected row
    let row = sheet.getRange(i,encodedCol.POST_URL,1,encodedCol.TIMER_DATE_TIME).getValues()[0];  // gets data row
    console.log(i,row);
    if(!isValid(row)){
      console.log('Row contains invalid data');
      setStatusValue(i,'Row contains invalid data',colorEnum.ERROR);
      ++i;
      continue;
    }
    // sets up parameters
    let params = {};  // initializes parameter object
    params.comment = expand(row[encodedCol.COMMENT-1]);
    params.row = i;
    if(row[encodedCol.HAS_DELETE_COMMENT_TIMER-1] === true){  // checks if has timer is ticked
      let timer = row[encodedCol.TIMER_DATE_TIME-1];  // gets timer's date time
      let now = new Date();   // gets current date time
      params.timeout = timeSubtract(timer,now);   // sets timeout of miliseconds from now to timer's date time
    }
    urlsList.push(row[encodedCol.POST_URL-1]);
    paramsList.push(params);
    ++i;  // next row
  }
  console.log(urlsList, paramsList);
  showWork(urlsList, paramsList);
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
  deleteProjectTriggers();
}