const BaseNode = require('./BaseNode');

/**
 * كلاس يمثل عقدة الوسائط (Media Node)
 * تركز فقط على تتبع Tasks التي تنفذها أدوات مثل yt-dlp أو axios.
 */
class MediaNode extends BaseNode {
    constructor({ id, deviceFriendlyName }) {
        // استدعاء الأب وتحديد Type
        super({ id, deviceFriendlyName, type: 'MEDIA_NODE' });

        // قائمة Tasks النشطة (روابط تحميل، تحويل صيغ، إلخ)
        this.activeTasks = []; 
    }

    /**
     * إضافة مهمة تحميل (مثلاً كائن يحتوي على Link والنسبة المئوية)
     */
    addTask(task) {
        this.activeTasks.push(task);
    }

   

    toJSON() {
        return {
            ...super.toJSON()
            // لا توجد خصائص إضافية للSave حالياً، نكتفي ببيانات الأب
        };
    }

    static fromJSON(data) {
        return new MediaNode(data);
    }
}

module.exports = MediaNode;