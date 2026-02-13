function doPost(e) {
  try {
    // Получаем доступ к активной таблице
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Парсим входящие данные
    const data = JSON.parse(e.postData.contents);
    
    // Добавляем строку в таблицу
    sheet.appendRow([
      data.ts_iso || new Date().toISOString(),
      data.review || '',
      data.sentiment || '',
      data.meta || ''
    ]);
    
    // Возвращаем успешный ответ с правильными CORS-заголовками
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, received: data }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      
  } catch (error) {
    // Логируем ошибку в таблицу (отдельно)
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Errors');
      if (!sheet) {
        SpreadsheetApp.getActiveSpreadsheet().insertSheet('Errors');
      }
      const errorSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Errors');
      errorSheet.appendRow([new Date(), error.toString(), JSON.stringify(e)]);
    } catch (e) {}
    
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders({
        'Access-Control-Allow-Origin': '*'
      });
  }
}

// Обработка OPTIONS запросов (для CORS preflight)
function doOptions() {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    });
}
